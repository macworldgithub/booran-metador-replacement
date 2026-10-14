import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { IngestLeadDto } from '../dto/ingest-lead.dto';
import { resolveRooftopId } from './adf-rooftop-map';
import { RooftopId } from '../../../common/enums';

@Injectable()
export class AdfParserService {
  private readonly logger = new Logger(AdfParserService.name);
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      trimValues: true,
      parseTagValue: false, // keep strings intact for phone numbers
    });
  }

  /**
   * Parse Auto-lead Data Format (ADF / XML 1.0) into IngestLeadDto.
   */
  parseAdf(
    xmlContent: string,
    entityMap: Record<string, RooftopId> = {},
  ): IngestLeadDto {
    try {
      const parsed = this.parser.parse(xmlContent);

      // Handle root <adf> or <ADF>
      const adf = parsed.adf || parsed.ADF || parsed;
      const prospect = adf.prospect || adf.Prospect;

      if (!prospect) {
        throw new BadRequestException(
          'Invalid ADF XML: missing <prospect> element',
        );
      }

      // 1. DealerSocket Opportunity ID / Prospect ID
      const idNodes = Array.isArray(prospect.id) ? prospect.id : [prospect.id];
      const idNode =
        idNodes.find(
          (node) =>
            node &&
            (typeof node === 'string' ||
              /dealersocket/i.test(String(node['@_source'] ?? ''))),
        ) ?? idNodes.find(Boolean);
      const opportunityId =
        typeof idNode === 'object'
          ? idNode['#text']
          : (idNode ?? prospect['@_id']);
      if (typeof opportunityId !== 'string' || !opportunityId.trim())
        throw new BadRequestException(
          'A stable DealerSocket opportunity ID is required',
        );

      // 2. Customer details
      const customer = prospect.customer || prospect.Customer || {};
      const contact = customer.contact || customer.Contact || customer;

      // Name parts
      let firstName = 'Valued';
      let lastName = 'Customer';

      if (contact.name) {
        if (typeof contact.name === 'string') {
          const parts = contact.name.trim().split(/\s+/);
          firstName = parts[0] || 'Valued';
          lastName = parts.slice(1).join(' ') || '';
        } else if (Array.isArray(contact.name)) {
          for (const n of contact.name) {
            const part = n['@_part'];
            const val = n['#text'] || n;
            if (part === 'first') firstName = val;
            if (part === 'last') lastName = val;
          }
        } else if (typeof contact.name === 'object') {
          firstName =
            contact.name['#text'] ||
            contact.name.first ||
            contact.name.firstName ||
            'Valued';
          lastName = contact.name.last || contact.name.lastName || '';
        }
      }

      // Phone
      let mobile = '';
      if (contact.phone) {
        const phones = Array.isArray(contact.phone)
          ? contact.phone
          : [contact.phone];
        for (const p of phones) {
          const phoneType = p['@_type'] || p['@_time'] || '';
          const phoneVal =
            typeof p === 'object' ? p['#text'] || p.text || '' : p;
          if (
            phoneType.toLowerCase().includes('cell') ||
            phoneType.toLowerCase().includes('mobile')
          ) {
            mobile = String(phoneVal);
            break;
          }
          if (!mobile && phoneVal) {
            mobile = String(phoneVal);
          }
        }
      }

      // Email
      let email: string | undefined;
      if (contact.email) {
        email =
          typeof contact.email === 'object'
            ? contact.email['#text'] || contact.email.text
            : String(contact.email);
      }

      // 3. Vendor / Rooftop identification
      const vendor = prospect.vendor || prospect.Vendor || {};
      const vendorName =
        vendor.vendorname ||
        vendor.name ||
        (typeof vendor === 'object' ? vendor['#text'] : '');
      const vendorNode = Array.isArray(vendor.id) ? vendor.id[0] : vendor.id;
      const vendorId =
        typeof vendorNode === 'object'
          ? vendorNode['#text']
          : vendorNode || vendor['@_id'];
      const rooftopId = resolveRooftopId(vendorId || vendorName, entityMap);

      // 4. Vehicle interest
      const vehicleNode = prospect.vehicle || prospect.Vehicle;
      let vehicle: IngestLeadDto['vehicle'] | undefined;
      if (vehicleNode) {
        const v = Array.isArray(vehicleNode) ? vehicleNode[0] : vehicleNode;
        const interest = v['@_interest'] || '';
        const status = v['@_status'] || '';
        const year = v.year ? parseInt(String(v.year), 10) : undefined;
        const make = v.make ? String(v.make) : undefined;
        const model = v.model ? String(v.model) : undefined;
        const stockNumber = v.stock ? String(v.stock) : undefined;
        const comments = v.comments || prospect.comments || undefined;

        vehicle = {
          make,
          model,
          year: isNaN(year!) ? undefined : year,
          isNew: status ? status.toLowerCase() === 'new' : undefined,
          stockNumber,
          comments:
            typeof comments === 'object' ? JSON.stringify(comments) : comments,
        };
      }

      // 5. Provider / Lead Source
      const provider = prospect.provider || prospect.Provider || {};
      const providerName =
        provider.name ||
        provider.service ||
        (typeof provider === 'object' ? provider['#text'] : '') ||
        'dealersocket-forward';

      // 6. Salesperson assignment
      const salespersonNode = prospect.salesperson || prospect.Salesperson;
      let salesperson: IngestLeadDto['salesperson'] | undefined;
      if (salespersonNode) {
        const spName =
          salespersonNode.name ||
          (typeof salespersonNode === 'object'
            ? salespersonNode['#text']
            : String(salespersonNode));
        const spEmail = salespersonNode.email;
        if (spName) {
          salesperson = {
            name: String(spName),
            email: spEmail ? String(spEmail) : undefined,
          };
        }
      }

      // 7. Request Date
      const requestDate = prospect.requestdate || new Date().toISOString();

      return {
        dealerSocketOpportunityId: String(opportunityId),
        dealerSocketCustomerId: customer['@_id']
          ? String(customer['@_id'])
          : undefined,
        rooftopId,
        customer: {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          mobile: String(mobile).trim(),
          email: email ? String(email).trim() : undefined,
        },
        vehicle,
        leadSource: String(providerName).trim().toLowerCase(),
        salesperson,
        receivedAt:
          typeof requestDate === 'string'
            ? requestDate
            : new Date().toISOString(),
        isNewLead: !['old', 'historical', 'closed'].includes(
          String(prospect['@_status'] ?? '').toLowerCase(),
        ),
      };
    } catch (err: any) {
      this.logger.error(`Failed to parse ADF XML: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to parse ADF XML: ${err.message}`);
    }
  }
}
