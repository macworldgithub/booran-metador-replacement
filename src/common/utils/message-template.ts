import { BadRequestException } from '@nestjs/common';
import { ProspectEntity, RooftopEntity } from '../../modules/database/entities';
export function renderMessage(
  template: string,
  prospect: ProspectEntity,
  rooftop: RooftopEntity,
) {
  const vehicle =
    [prospect.vehicle.year, prospect.vehicle.make, prospect.vehicle.model]
      .filter(Boolean)
      .join(' ') || 'the vehicle you enquired about';
  const fields = {
    firstName: prospect.customer.firstName || 'there',
    rooftopName: rooftop.name,
    brand: rooftop.name.includes('Kia')
      ? 'Kia'
      : rooftop.name.includes('MG')
        ? 'MG'
        : 'Geely',
    vehicleDesc: vehicle,
    salespersonName: prospect.assignedTo?.name?.split(' ')[0] || 'the team',
    phone: rooftop.displayPhone,
  };
  return template.replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in fields))
      throw new BadRequestException(`Unknown merge field: ${key}`);
    return fields[key as keyof typeof fields];
  });
}
export function compliantMessage(content: string, rooftop: RooftopEntity) {
  let body = content.trim();
  if (!body.includes(rooftop.name)) body += `\n\n${rooftop.name}`;
  if (!body.includes(rooftop.displayPhone))
    body += ` · ${rooftop.displayPhone}`;
  if (!/reply\s+STOP\b/i.test(body)) body += ' · Reply STOP to opt out.';
  if (body.length > 1600)
    throw new BadRequestException(
      'Message including the required footer exceeds 1600 characters',
    );
  return body;
}
