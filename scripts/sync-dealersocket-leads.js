const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Mongoose Schemas
const ProspectSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  dealerSocketOpportunityId: { type: String, required: true, index: true },
  dealerSocketCustomerId: String,
  rooftopId: { type: String, required: true, index: true },
  customer: {
    firstName: { type: String, required: true },
    lastName: String,
    mobile: { type: String, required: true },
    email: String,
  },
  normalizedMobile: { type: String, required: true, index: true },
  vehicle: {
    make: String,
    model: String,
    year: Number,
    isNew: Boolean,
    stockNumber: String,
    comments: String,
  },
  leadSource: { type: String, required: true },
  assignedTo: {
    name: String,
    email: String,
    id: String,
  },
  status: { type: String, required: true, default: 'new' },
  journey: {
    status: { type: String, enum: ['active', 'paused', 'completed', 'stopped'], default: 'paused' },
    currentStep: { type: Number, default: 0 },
    currentStepName: { type: String, default: 'DealerSocket Sync (Read-Only)' },
    pausedReason: { type: String, default: 'DealerSocket Live Sync - Read Only (SMS Disabled)' },
    lastStepSentAt: Date,
    nextScheduledStepAt: Date,
  },
  outcome: String,
  unreadInboundCount: { type: Number, default: 0 },
  lastInboundAt: Date,
  lastActivityAt: { type: Date, required: true },
  receivedAt: Date,
  leadType: { type: String, default: 'new_vehicle_internet' },
  consent: Object,
  opportunityAliases: [String],
}, { collection: 'prospects', timestamps: true, versionKey: false });

const ThreadEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  prospectId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  direction: { type: String, required: true },
  content: { type: String, required: true },
  authorName: String,
  journeyStepName: String,
  deliveryStatus: String,
  failureReason: String,
  mediaUrls: [String],
  metadata: Object,
  timestamp: { type: Date, required: true, index: true },
}, { collection: 'thread_events', versionKey: false });

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, required: true },
  rooftopIds: [{ type: String }],
  isActive: { type: Boolean, default: true },
}, { collection: 'users', timestamps: true, versionKey: false });

// Helper to parse CSV properly handling quoted commas
function parseCsv(content) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentLine.push(currentField);
      if (currentLine.some(f => f.trim().length > 0)) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField);
    if (currentLine.some(f => f.trim().length > 0)) {
      lines.push(currentLine);
    }
  }
  
  if (lines.length < 2) return [];
  const headers = lines[0].map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (lines[i][j] || '').trim().replace(/^"|"$/g, '');
    }
    rows.push(row);
  }
  return rows;
}

const ROOFTOP_MAP = {
  'Cranbourne Kia': 'cranbourne_kia',
  'Cranbourne MG': 'cranbourne_mg',
  'Geely Cranbourne': 'geely_cranbourne',
};

async function sync() {
  const csvPath = path.resolve('D:/Hammad/metaphor-replacement-api/downloads/cranbourne-20261014T091316777956Z/opportunities.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Reading scraped opportunities from: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvContent);
  console.log(`Found ${rows.length} records in CSV.`);

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/matador-replacement';
  console.log(`Connecting to MongoDB: ${mongoUri}`);
  await mongoose.connect(mongoUri);

  const Prospect = mongoose.model('Prospect', ProspectSchema);
  const ThreadEvent = mongoose.model('ThreadEvent', ThreadEventSchema);
  const User = mongoose.model('User', UserSchema);

  // Check or create default admin
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('Admin@2026!', 12);
    await User.create({
      email: 'admin@booran.com.au',
      passwordHash,
      name: 'Group Admin',
      role: 'group_admin',
      rooftopIds: ['cranbourne_kia', 'cranbourne_mg', 'geely_cranbourne'],
      isActive: true,
    });
    console.log('Created default admin: admin@booran.com.au / Admin@2026!');
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const rooftopCounts = { cranbourne_kia: 0, cranbourne_mg: 0, geely_cranbourne: 0 };

  for (const row of rows) {
    const oppId = row.opportunity_id;
    const rooftopId = ROOFTOP_MAP[row.rooftop];
    if (!rooftopId) {
      console.warn(`Unknown rooftop: ${row.rooftop} for Opp #${oppId}`);
      skipped++;
      continue;
    }

    // Name splitting
    const rawName = row.customer_name || 'Valued Customer';
    const nameParts = rawName.split(/\s+/);
    const firstName = nameParts[0] || 'Customer';
    let lastName = nameParts.slice(1).join(' ');
    if (lastName === 'No_Last_Name' || lastName === 'N/a' || lastName === '.') {
      lastName = '';
    }

    // Phone normalisation
    const phone = row.customer_phone || row.customer_phone_raw || '+61400000000';
    const isValid = row.mobile_valid === 'True' || row.mobile_valid === 'true';

    // Vehicle
    const rawVehicle = row.vehicle_of_interest || '';
    const yearMatch = rawVehicle.match(/\b(202[0-9])\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
    const make = row.rooftop.includes('Kia') ? 'Kia' : row.rooftop.includes('MG') ? 'MG' : 'Geely';

    const comments = row.customer_comments || row.description || '';
    const receivedDate = row.received_timestamp ? new Date(row.received_timestamp) : new Date();
    const updatedDate = row.last_updated_timestamp ? new Date(row.last_updated_timestamp) : receivedDate;

    const prospectId = `pr_ds_${oppId}`;

    const prospectData = {
      id: prospectId,
      dealerSocketOpportunityId: oppId,
      dealerSocketCustomerId: row.customer_id || '',
      rooftopId,
      customer: {
        firstName,
        lastName,
        mobile: row.customer_phone_raw || phone,
        email: row.customer_email || undefined,
      },
      normalizedMobile: phone,
      vehicle: {
        make,
        model: rawVehicle || 'Vehicle of Interest',
        year,
        isNew: true,
        comments: comments || undefined,
      },
      leadSource: row.lead_source || 'Website',
      assignedTo: row.assigned_salesperson ? {
        name: row.assigned_salesperson,
        id: row.assigned_salesperson_id || undefined,
      } : undefined,
      status: isValid ? 'new' : 'closed',
      journey: {
        status: 'paused',
        currentStep: 0,
        currentStepName: 'DealerSocket Sync (Read-Only)',
        pausedReason: 'Live DealerSocket Sync - Read Only (SMS Disabled)',
      },
      unreadInboundCount: 0,
      receivedAt: receivedDate,
      lastActivityAt: updatedDate,
      leadType: 'new_vehicle_internet',
      consent: {
        enquiryConsent: true,
        marketingConsent: false,
        evidence: 'DealerSocket enquiry lead intake',
        recordedAt: receivedDate,
      },
    };

    const existing = await Prospect.findOne({ dealerSocketOpportunityId: oppId });
    if (existing) {
      await Prospect.updateOne({ dealerSocketOpportunityId: oppId }, { $set: prospectData });
      updated++;
    } else {
      await Prospect.create(prospectData);
      imported++;

      // Create initial system audit thread event
      const eventId = `sys_ds_${oppId}_sync`;
      await ThreadEvent.create({
        id: eventId,
        prospectId,
        type: 'system',
        direction: 'internal',
        content: `Lead synced from DealerSocket Opportunities (Opp #${oppId}, CRM Status: ${row.opportunity_status || 'New'}). Read-only sync active.`,
        timestamp: receivedDate,
      });

      // If customer submitted a message/comment, add as submitted lead note
      if (comments && comments.trim().length > 0) {
        await ThreadEvent.create({
          id: `note_ds_${oppId}_lead_note`,
          prospectId,
          type: 'internal_note',
          direction: 'internal',
          content: `Customer Lead Comments (${row.lead_source || 'DealerSocket'}): "${comments.trim()}"`,
          authorName: 'DealerSocket Intake',
          timestamp: receivedDate,
        });
      }
    }

    rooftopCounts[rooftopId]++;
  }

  console.log('\n=============================================');
  console.log('DealerSocket Scraped Opportunities Sync Report');
  console.log('=============================================');
  console.log(`Total Scraped Rows Processed: ${rows.length}`);
  console.log(`New Prospects Imported:        ${imported}`);
  console.log(`Existing Prospects Updated:    ${updated}`);
  console.log(`Skipped Records:               ${skipped}`);
  console.log('---------------------------------------------');
  console.log('Rooftop Breakdown:');
  console.log(`  - Cranbourne Kia:    ${rooftopCounts.cranbourne_kia}`);
  console.log(`  - Cranbourne MG:     ${rooftopCounts.cranbourne_mg}`);
  console.log(`  - Geely Cranbourne:  ${rooftopCounts.geely_cranbourne}`);
  console.log('=============================================\n');

  await mongoose.disconnect();
}

sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});