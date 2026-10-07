/**
 * Seed script: fills the database with demo data — demo users, organizations,
 * venues, a large catalog of event materials/resources, ~38 demo events with
 * venue/schedule collisions, booking requests and guaranteed resource
 * shortages, plus resource requirements and reservations so the readiness,
 * conflicts, bookings, analytics and list-pagination pages have real data.
 *
 * Usage:  npm run seed        (idempotent — safe to re-run)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Venue = require('./models/Venue');
const Resource = require('./models/Resource');
const Event = require('./models/Event');
const User = require('./models/User');
const Booking = require('./models/Booking');
const ResourceRequirement = require('./models/ResourceRequirement');
const ResourceReservation = require('./models/ResourceReservation');
const { hashPassword } = require('./utils/password');

const ORGANIZATIONS = [
  { name: 'Aurora Event Solutions', description: 'Full-service event planning and production company.', email: 'hello@aurora-events.test', phone: '+1-555-0101', website: 'https://aurora-events.test', address: { street: '12 Marigold Ave', city: 'Springfield', state: 'IL', zipCode: '62701', country: 'USA' } },
  { name: 'Metro Convention Bureau', description: 'Runs city conventions, trade shows and summits.', email: 'bookings@metroconv.test', phone: '+1-555-0102', address: { street: '500 Convention Way', city: 'Springfield', state: 'IL', zipCode: '62702', country: 'USA' } },
  { name: 'Sunrise Catering Group', description: 'Catering and banquet services for events of all sizes.', email: 'orders@sunrisecater.test', phone: '+1-555-0103', address: { street: '88 Bakery Rd', city: 'Riverton', state: 'IL', zipCode: '62703', country: 'USA' } },
  { name: 'Campus Activities Board', description: 'Student organization running campus events and fairs.', email: 'cab@campus.test', phone: '+1-555-0104', address: { street: '1 University Plaza', city: 'Springfield', state: 'IL', zipCode: '62704', country: 'USA' } },
];

const VENUES = [
  { name: 'Grand Ballroom', capacity: 800, venueType: 'indoor', address: { street: '12 Marigold Ave', city: 'Springfield', state: 'IL', zipCode: '62701', country: 'USA' }, contactPhone: '+1-555-0201' },
  { name: 'Summit Conference Hall', capacity: 350, venueType: 'indoor', address: { street: '500 Convention Way', city: 'Springfield', state: 'IL', zipCode: '62702', country: 'USA' }, contactPhone: '+1-555-0202' },
  { name: 'Riverside Garden Lawn', capacity: 500, venueType: 'outdoor', address: { street: '9 River Rd', city: 'Riverton', state: 'IL', zipCode: '62710', country: 'USA' }, contactPhone: '+1-555-0203' },
  { name: 'Tech Auditorium', capacity: 220, venueType: 'indoor', address: { street: '1 University Plaza', city: 'Springfield', state: 'IL', zipCode: '62704', country: 'USA' }, contactPhone: '+1-555-0204' },
  { name: 'City Sports Complex', capacity: 1200, venueType: 'hybrid', address: { street: '77 Stadium Blvd', city: 'Springfield', state: 'IL', zipCode: '62705', country: 'USA' }, contactPhone: '+1-555-0205' },
  { name: 'Lakeside Pavilion', capacity: 300, venueType: 'outdoor', address: { street: '24 Lakeshore Dr', city: 'Riverton', state: 'IL', zipCode: '62711', country: 'USA' }, contactPhone: '+1-555-0206' },
  { name: 'Heritage Theater', capacity: 450, venueType: 'indoor', address: { street: '310 Main St', city: 'Springfield', state: 'IL', zipCode: '62706', country: 'USA' }, contactPhone: '+1-555-0207' },
  { name: 'Innovation Lab Room', capacity: 80, venueType: 'indoor', address: { street: '1 University Plaza', city: 'Springfield', state: 'IL', zipCode: '62704', country: 'USA' }, contactPhone: '+1-555-0208' },
  { name: 'Rooftop Terrace', capacity: 150, venueType: 'outdoor', address: { street: '400 Skyline Ave', city: 'Springfield', state: 'IL', zipCode: '62707', country: 'USA' }, contactPhone: '+1-555-0209' },
  { name: 'Oceanview Resort Hall', capacity: 600, venueType: 'hybrid', address: { street: '1 Seaside Blvd', city: 'Bay City', state: 'IL', zipCode: '62720', country: 'USA' }, contactPhone: '+1-555-0210' },
];

// name, category, unit, quantityTotal, costPerUnit
const RESOURCES = [
  // --- furniture ---
  ['Folding Chair', 'furniture', 'unit', 400, 2],
  ['Banquet Chair', 'furniture', 'unit', 250, 4],
  ['Chiavari Chair', 'furniture', 'unit', 150, 8],
  ['Bar Stool', 'furniture', 'unit', 60, 6],
  ['Office Chair', 'furniture', 'unit', 40, 10],
  ['Kids Chair Set', 'furniture', 'set', 30, 12],
  ['Round Banquet Table 60in', 'furniture', 'unit', 80, 15],
  ['Rectangular Table 8ft', 'furniture', 'unit', 90, 18],
  ['High-Top Cocktail Table', 'furniture', 'unit', 45, 14],
  ['Coffee Table', 'furniture', 'unit', 20, 25],
  ['Conference Table', 'furniture', 'unit', 12, 120],
  ['Registration Desk', 'furniture', 'unit', 6, 80],
  ['Podium', 'furniture', 'unit', 4, 60],
  ['Stage Platform Block', 'furniture', 'unit', 24, 90],
  ['Sofa Set', 'furniture', 'set', 8, 300],
  ['Lounge Armchair', 'furniture', 'unit', 16, 95],
  ['Coat Rack', 'furniture', 'unit', 10, 20],
  ['Bookshelf', 'furniture', 'unit', 8, 45],
  ['Buffet Table', 'furniture', 'unit', 15, 55],
  ['Tiered Riser Set', 'furniture', 'set', 10, 35],
  // --- audio_visual ---
  ['HD Projector 5000lm', 'audio_visual', 'unit', 12, 450],
  ['Portable Projector', 'audio_visual', 'unit', 18, 220],
  ['Projector Screen 100in', 'audio_visual', 'unit', 14, 130],
  ['Projector Screen 150in', 'audio_visual', 'unit', 6, 260],
  ['LED Video Wall Panel', 'audio_visual', 'unit', 20, 900],
  ['Confidence Monitor', 'audio_visual', 'unit', 8, 350],
  ['PA Speaker 15in', 'audio_visual', 'unit', 22, 280],
  ['Subwoofer Speaker', 'audio_visual', 'unit', 10, 320],
  ['Line Array Speaker Set', 'audio_visual', 'set', 4, 1800],
  ['Wireless Handheld Mic', 'audio_visual', 'unit', 30, 95],
  ['Wireless Lavalier Mic', 'audio_visual', 'unit', 25, 110],
  ['Headset Mic', 'audio_visual', 'unit', 15, 120],
  ['Wired Microphone', 'audio_visual', 'unit', 35, 40],
  ['Audio Mixing Console 16ch', 'audio_visual', 'unit', 6, 650],
  ['Audio Mixer 8ch', 'audio_visual', 'unit', 8, 380],
  ['Speaker Tripod Stand', 'audio_visual', 'unit', 20, 45],
  ['Wireless Presenter Clicker', 'audio_visual', 'unit', 20, 30],
  ['Laser Pointer', 'audio_visual', 'unit', 25, 15],
  ['HDMI Switcher', 'audio_visual', 'unit', 8, 170],
  ['Audio Interface', 'audio_visual', 'unit', 6, 210],
  ['Media Playback Unit', 'audio_visual', 'unit', 6, 240],
  ['PTZ Camera', 'audio_visual', 'unit', 5, 1100],
  // --- decoration ---
  ['Floral Centerpiece', 'decoration', 'unit', 60, 25],
  ['Stage Backdrop', 'decoration', 'unit', 8, 400],
  ['Balloon Arch', 'decoration', 'unit', 12, 120],
  ['Table Linen Set', 'decoration', 'set', 90, 18],
  ['Chair Cover', 'decoration', 'unit', 200, 5],
  ['LED Uplight', 'decoration', 'unit', 40, 55],
  ['Drape Panel', 'decoration', 'unit', 30, 70],
  ['Welcome Signage', 'decoration', 'unit', 15, 45],
  ['Flower Arch Gate', 'decoration', 'unit', 6, 500],
  ['Stage Curtain', 'decoration', 'unit', 6, 350],
  ['Carpet Runner', 'decoration', 'unit', 20, 60],
  ['Banner Stand', 'decoration', 'unit', 25, 40],
  ['Candle Centerpiece Set', 'decoration', 'set', 50, 20],
  ['Themed Prop Box', 'decoration', 'set', 10, 85],
  ['Table Runner', 'decoration', 'unit', 70, 8],
  // --- catering ---
  ['Chafing Dish Set', 'catering', 'set', 40, 45],
  ['Coffee Urn 10L', 'catering', 'unit', 12, 70],
  ['Water Dispenser', 'catering', 'unit', 15, 55],
  ['Juice Dispenser', 'catering', 'unit', 12, 50],
  ['Dinnerware Set', 'catering', 'set', 100, 22],
  ['Glassware Set', 'catering', 'set', 120, 16],
  ['Cutlery Set', 'catering', 'set', 150, 10],
  ['Cake Stand', 'catering', 'unit', 20, 25],
  ['Tea Service Set', 'catering', 'set', 15, 60],
  ['Serving Platter', 'catering', 'unit', 45, 18],
  ['Ice Bin', 'catering', 'unit', 10, 40],
  ['Beverage Cooler', 'catering', 'unit', 8, 90],
  ['Linen Napkin Set', 'catering', 'set', 100, 6],
  ['Tiered Dessert Stand', 'catering', 'unit', 18, 30],
  ['Cutlery Caddy', 'catering', 'unit', 30, 12],
  // --- IT ---
  ['Laptop', 'IT', 'unit', 25, 800],
  ['Tablet', 'IT', 'unit', 20, 350],
  ['Wi-Fi Access Point', 'IT', 'unit', 15, 180],
  ['Portable Router', 'IT', 'unit', 10, 120],
  ['Power Strip Extension Cord', 'IT', 'unit', 60, 15],
  ['Multiport Hub', 'IT', 'unit', 20, 45],
  ['Printer', 'IT', 'unit', 6, 250],
  ['Scanner', 'IT', 'unit', 4, 190],
  ['USB Webcam', 'IT', 'unit', 15, 70],
  ['Streaming Encoder', 'IT', 'unit', 4, 600],
  ['Ethernet Cable Kit', 'IT', 'set', 30, 25],
  ['Power Bank Station', 'IT', 'set', 8, 150],
  ['External SSD', 'IT', 'unit', 10, 110],
  ['Conference Speakerphone', 'IT', 'unit', 10, 140],
  // --- transport ---
  ['Delivery Van', 'transport', 'hour', 4, 60],
  ['Pickup Truck', 'transport', 'hour', 3, 45],
  ['Cargo Trolley', 'transport', 'unit', 12, 70],
  ['Hand Truck Dolly', 'transport', 'unit', 10, 50],
  ['Shuttle Bus Seat', 'transport', 'seat', 60, 8],
  ['Golf Cart', 'transport', 'hour', 4, 35],
  ['Pallet Jack', 'transport', 'unit', 6, 130],
  ['Utility Trailer', 'transport', 'day', 3, 90],
  // --- other ---
  ['First Aid Kit', 'other', 'unit', 10, 45],
  ['Fire Extinguisher', 'other', 'unit', 12, 60],
  ['Portable Generator', 'other', 'unit', 5, 750],
  ['Event Tent 6x6m', 'other', 'unit', 14, 600],
  ['Canopy Tent 3x3m', 'other', 'unit', 18, 220],
  ['Crowd Control Barrier', 'other', 'unit', 40, 55],
  ['Signage Board', 'other', 'unit', 25, 30],
  ['Waste Bin Set', 'other', 'set', 20, 35],
  ['Portable Fan Heater', 'other', 'unit', 16, 80],
  ['Walkie-Talkie Set', 'other', 'set', 12, 160],
];

const REQ_STATUS = ['pending', 'partially_reserved', 'reserved', 'fulfilled'];
const PRIORITIES = ['low', 'medium', 'high'];
const ACTIVE_RESERVATION_STATUSES = ['reserved', 'issued'];
const FRACTIONS = [0.1, 0.15, 0.2, 0.25];
const MAX_USES_PER_RESOURCE = 3;

// --- demo users (bookers + management) so seeded events/bookings are visible ---
const SEED_PASSWORD = 'secret123';
const SEED_USERS = [
  { name: 'Dana Reyes', email: 'seed.booker@eventory.test', role: 'booker' },
  { name: 'Milo Tanaka', email: 'seed.booker2@eventory.test', role: 'booker' },
  { name: 'Priya Nair', email: 'seed.manager@eventory.test', role: 'management' },
];
const B1 = 'seed.booker@eventory.test';
const B2 = 'seed.booker2@eventory.test';

const ev = (name, org, venue, start, end, status, category, expectedAttendees, owner) => ({
  name, org, venue, start, end, status, category, expectedAttendees, owner,
});

// ~38 demo events. Deliberate collision groups so the Conflicts page has data:
//  - venue clusters: same venue + overlapping time on one date (10 pairs)
//  - schedule groups: same org, different venues, same date, overlapping (9 pairs)
//  - plus past/completed, cancelled and ongoing events for status variety.
const EVENT_DEFS = [
  // --- venue collision cluster: Grand Ballroom, 2026-10-20 (3 pairs) ---
  ev('Aurora Gala Night', 'Aurora Event Solutions', 'Grand Ballroom', '2026-10-20T18:00', '2026-10-20T23:00', 'planned', 'corporate', 600, B1),
  ev('Metro Product Launch', 'Metro Convention Bureau', 'Grand Ballroom', '2026-10-20T20:00', '2026-10-20T23:30', 'planned', 'exhibition', 500, B1),
  ev('Charity Auction Evening', 'Sunrise Catering Group', 'Grand Ballroom', '2026-10-20T19:00', '2026-10-20T22:00', 'planned', 'other', 450, B2),
  // --- venue collision cluster: Tech Auditorium, 2026-11-05 (3 pairs) ---
  ev('DevCon Keynote', 'Campus Activities Board', 'Tech Auditorium', '2026-11-05T09:00', '2026-11-05T13:00', 'planned', 'conference', 200, B1),
  ev('AI Workshop Series', 'Aurora Event Solutions', 'Tech Auditorium', '2026-11-05T11:00', '2026-11-05T16:00', 'planned', 'workshop', 180, B1),
  ev('Robotics League Day', 'Metro Convention Bureau', 'Tech Auditorium', '2026-11-05T12:00', '2026-11-05T17:00', 'planned', 'sports', 160, B1),
  // --- venue collision cluster: Summit Conference Hall, 2026-12-03 (1 pair) ---
  ev('Healthcare Summit', 'Metro Convention Bureau', 'Summit Conference Hall', '2026-12-03T09:00', '2026-12-03T17:00', 'planned', 'conference', 320, B1),
  ev('Education Expo', 'Campus Activities Board', 'Summit Conference Hall', '2026-12-03T13:00', '2026-12-03T18:00', 'planned', 'exhibition', 300, B1),
  // --- venue collision cluster: Riverside Garden Lawn, 2027-03-14 (1 pair) ---
  ev('Spring Food Fair', 'Sunrise Catering Group', 'Riverside Garden Lawn', '2027-03-14T10:00', '2027-03-14T16:00', 'planned', 'other', 400, B2),
  ev('Alumni Homecoming', 'Campus Activities Board', 'Riverside Garden Lawn', '2027-03-14T12:00', '2027-03-14T18:00', 'planned', 'other', 350, B1),
  // --- venue collision cluster: Lakeside Pavilion, 2027-04-10 (1 pair) ---
  ev('Wedding Expo Lakeside', 'Sunrise Catering Group', 'Lakeside Pavilion', '2027-04-10T15:00', '2027-04-10T21:00', 'draft', 'exhibition', 250, B2),
  ev('Riverside Jazz Evening', 'Aurora Event Solutions', 'Lakeside Pavilion', '2027-04-10T18:00', '2027-04-10T23:00', 'planned', 'concert', 280, B1),
  // --- venue collision cluster: Heritage Theater, 2027-02-06 (1 pair) ---
  ev('Film Screening Night', 'Aurora Event Solutions', 'Heritage Theater', '2027-02-06T17:00', '2027-02-06T21:00', 'planned', 'other', 400, B1),
  ev('Student Theatre Showcase', 'Campus Activities Board', 'Heritage Theater', '2027-02-06T19:00', '2027-02-06T22:30', 'draft', 'other', 380, B2),
  // --- schedule collisions: same org, different venues, overlapping times ---
  ev('Leadership Forum', 'Aurora Event Solutions', 'Innovation Lab Room', '2027-01-16T09:00', '2027-01-16T13:00', 'planned', 'corporate', 70, B1),
  ev('Brand Strategy Workshop', 'Aurora Event Solutions', 'Rooftop Terrace', '2027-01-16T11:00', '2027-01-16T15:00', 'planned', 'workshop', 100, B1),
  ev('Trade Mission Briefing', 'Metro Convention Bureau', 'City Sports Complex', '2027-02-20T09:00', '2027-02-20T12:00', 'planned', 'corporate', 200, B1),
  ev('Exporters Networking Meetup', 'Metro Convention Bureau', 'Oceanview Resort Hall', '2027-02-20T10:00', '2027-02-20T14:00', 'planned', 'conference', 150, B1),
  ev('Culinary Masters Demo', 'Sunrise Catering Group', 'Lakeside Pavilion', '2027-03-20T10:00', '2027-03-20T14:00', 'planned', 'workshop', 180, B2),
  ev('Tasting Sessions Afternoon', 'Sunrise Catering Group', 'Rooftop Terrace', '2027-03-20T12:00', '2027-03-20T16:00', 'draft', 'workshop', 120, B2),
  ev('Intramural Sports Finals', 'Campus Activities Board', 'City Sports Complex', '2027-04-17T09:00', '2027-04-17T13:00', 'planned', 'sports', 800, B1),
  ev('Sports Award Ceremony', 'Campus Activities Board', 'Heritage Theater', '2027-04-17T11:00', '2027-04-17T15:00', 'planned', 'other', 420, B1),
  ev('Spring Career Fair', 'Aurora Event Solutions', 'Tech Auditorium', '2027-05-08T09:00', '2027-05-08T15:00', 'planned', 'exhibition', 500, B1),
  ev('Employer Talk Series', 'Aurora Event Solutions', 'Innovation Lab Room', '2027-05-08T13:00', '2027-05-08T17:00', 'planned', 'conference', 75, B1),
  ev('Innovation Challenge Kickoff', 'Metro Convention Bureau', 'Summit Conference Hall', '2027-05-08T09:00', '2027-05-08T13:00', 'planned', 'workshop', 250, B1),
  ev('Startup Demo Day', 'Metro Convention Bureau', 'Tech Auditorium', '2027-05-08T11:00', '2027-05-08T16:00', 'draft', 'exhibition', 180, B1),
  ev('Bridal & Home Showcase', 'Sunrise Catering Group', 'Grand Ballroom', '2027-05-22T10:00', '2027-05-22T16:00', 'planned', 'exhibition', 550, B2),
  ev('Cake Tasting Fair', 'Sunrise Catering Group', 'Lakeside Pavilion', '2027-05-22T13:00', '2027-05-22T18:00', 'planned', 'other', 200, B2),
  ev('Research Symposium', 'Campus Activities Board', 'Summit Conference Hall', '2027-06-05T10:00', '2027-06-05T15:00', 'planned', 'conference', 260, B1),
  ev('Study Skills Kickoff', 'Campus Activities Board', 'Innovation Lab Room', '2027-06-05T09:00', '2027-06-05T12:00', 'planned', 'workshop', 70, B1),
  ev('Photo Walk Riverside', 'Aurora Event Solutions', 'Riverside Garden Lawn', '2027-06-12T08:00', '2027-06-12T12:00', 'draft', 'workshop', 90, B1),
  ev('Street Photography Exhibition', 'Aurora Event Solutions', 'Heritage Theater', '2027-06-12T10:00', '2027-06-12T14:00', 'planned', 'exhibition', 300, B1),
  // --- past / ongoing events for status variety ---
  ev('Board Retreat Weekend', 'Metro Convention Bureau', 'Oceanview Resort Hall', '2026-06-06T09:00', '2026-06-06T17:00', 'cancelled', 'corporate', 40, B2),
  ev('Midyear Tech Meetup', 'Campus Activities Board', 'Tech Auditorium', '2026-07-18T13:00', '2026-07-18T17:00', 'completed', 'conference', 150, B1),
  ev('Summer Music Fest', 'Aurora Event Solutions', 'Riverside Garden Lawn', '2026-08-15T16:00', '2026-08-15T23:00', 'completed', 'concert', 450, B1),
  ev('Community Fun Run', 'Campus Activities Board', 'City Sports Complex', '2026-09-12T07:00', '2026-09-12T11:00', 'completed', 'sports', 600, B1),
  ev('Autumn Craft Fair', 'Sunrise Catering Group', 'Grand Ballroom', '2026-09-26T10:00', '2026-09-26T18:00', 'cancelled', 'exhibition', 300, B1),
  ev('Weekend Innovation Bootcamp', 'Campus Activities Board', 'Innovation Lab Room', '2026-10-02T09:00', '2026-10-06T18:00', 'ongoing', 'workshop', 60, B1),
];

// [eventName, resourceName, quantity] — quantity exceeds total stock, so the
// event always reports a resource conflict and shows NOT READY on readiness.
const SHORTAGE_REQS = [
  ['Aurora Gala Night', 'Podium', 6],
  ['DevCon Keynote', 'Streaming Encoder', 6],
  ['Healthcare Summit', 'Coffee Urn 10L', 16],
  ['Spring Food Fair', 'Chafing Dish Set', 60],
  ['Film Screening Night', 'PA Speaker 15in', 28],
  ['Leadership Forum', 'Confidence Monitor', 12],
  ['Trade Mission Briefing', 'Wireless Handheld Mic', 40],
  ['Culinary Masters Demo', 'Tea Service Set', 20],
  ['Intramural Sports Finals', 'Crowd Control Barrier', 60],
  ['Spring Career Fair', 'Registration Desk', 10],
  ['Bridal & Home Showcase', 'Flower Arch Gate', 9],
  ['Research Symposium', 'Line Array Speaker Set', 5],
  ['Summer Music Fest', 'Portable Generator', 8],
];

// Pending-heavy so the management Bookings list paginates on the Pending filter.
const BOOKING_CYCLE = ['Pending', 'Pending', 'Approved', 'Pending', 'Rejected', 'Approved', 'Pending', 'Approved', 'Pending', 'Pending'];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB connected');

  // --- organizations (skip names that already exist) ---
  const orgNames = (await Organization.find({ name: { $in: ORGANIZATIONS.map((o) => o.name) } }).select('name')).map((o) => o.name);
  const newOrgs = ORGANIZATIONS.filter((o) => !orgNames.includes(o.name));
  if (newOrgs.length) await Organization.insertMany(newOrgs);

  // --- venues ---
  const venueNames = (await Venue.find({ name: { $in: VENUES.map((v) => v.name) } }).select('name')).map((v) => v.name);
  const newVenues = VENUES.filter((v) => !venueNames.includes(v.name));
  if (newVenues.length) {
    const allOrgs = await Organization.find().select('_id').lean();
    await Venue.insertMany(newVenues.map((v, i) => ({ ...v, organization: allOrgs[i % allOrgs.length]._id })));
  }

  // --- resources: the big catalog of event materials ---
  const resourceNames = new Set((await Resource.find({ name: { $in: RESOURCES.map((r) => r[0]) } }).select('name')).map((r) => r.name));
  const newResources = RESOURCES.filter((r) => !resourceNames.has(r[0])).map(([name, category, unit, quantityTotal, costPerUnit]) => ({
    name,
    category,
    unit,
    quantityTotal,
    quantityAvailable: quantityTotal,
    costPerUnit,
    isAvailable: quantityTotal > 0,
    description: `${name} available for event booking.`,
  }));
  if (newResources.length) await Resource.insertMany(newResources);

  // --- demo users (skip emails that already exist) ---
  const seedEmails = SEED_USERS.map((u) => u.email);
  const existingEmails = new Set((await User.find({ email: { $in: seedEmails } }).select('email')).map((u) => u.email));
  const newUserDocs = SEED_USERS.filter((u) => !existingEmails.has(u.email));
  if (newUserDocs.length) {
    const hashed = await hashPassword(SEED_PASSWORD);
    await User.insertMany(newUserDocs.map((u) => ({ ...u, password: hashed })));
  }
  const seedUsers = await User.find({ email: { $in: seedEmails } });
  const userIdByEmail = new Map(seedUsers.map((u) => [u.email, u._id]));
  const defaultBookerId = userIdByEmail.get(B1);

  // --- demo events (skip names that already exist) ---
  const orgIdByName = new Map((await Organization.find()).map((o) => [o.name, o._id]));
  const venueIdByName = new Map((await Venue.find()).map((v) => [v.name, v._id]));
  const existingEventNames = new Set(
    (await Event.find({ name: { $in: EVENT_DEFS.map((e) => e.name) } }).select('name')).map((e) => e.name)
  );
  const newEventDefs = EVENT_DEFS.filter((e) => !existingEventNames.has(e.name));
  if (newEventDefs.length) {
    await Event.insertMany(newEventDefs.map((e) => {
      const organization = orgIdByName.get(e.org);
      const venue = venueIdByName.get(e.venue);
      if (!organization) throw new Error(`Seed event references unknown organization: ${e.org}`);
      if (!venue) throw new Error(`Seed event references unknown venue: ${e.venue}`);
      return {
        name: e.name,
        organization,
        venue,
        bookerId: userIdByEmail.get(e.owner),
        startDate: new Date(e.start),
        endDate: new Date(e.end),
        status: e.status,
        category: e.category,
        expectedAttendees: e.expectedAttendees,
        description: `${e.name} — ${e.category} event at ${e.venue}. Seeded demo data.`,
      };
    }));
  }

  // --- requirements + reservations for every existing event ---
  const events = await Event.find().sort({ startDate: 1 });
  const resources = await Resource.find().sort({ createdAt: 1 });
  const existingReqs = await ResourceRequirement.find({ event: { $in: events.map((e) => e._id) } }).select('event resource');
  const haveKeys = new Set(existingReqs.map((r) => `${r.event}:${r.resource}`));
  // Existing requirements count toward each event's target so re-runs add nothing.
  const existingPerEvent = new Map();
  for (const req of existingReqs) {
    const key = String(req.event);
    existingPerEvent.set(key, (existingPerEvent.get(key) || 0) + 1);
  }

  const usage = new Map(resources.map((r) => [String(r._id), 0]));
  // Stock left to hand out to seeded active reservations: total minus holds
  // that already exist (fresh DB starts at full stock, re-runs subtract prior holds).
  const priorHolds = new Map();
  for (const hold of await ResourceReservation.find({ status: { $in: ACTIVE_RESERVATION_STATUSES } }).select('resource quantity')) {
    const rid = String(hold.resource);
    priorHolds.set(rid, (priorHolds.get(rid) || 0) + hold.quantity);
  }
  const remainingStock = new Map(
    resources.map((r) => [
      String(r._id),
      Math.max(0, (r.quantityTotal || 0) - (priorHolds.get(String(r._id)) || 0)),
    ]),
  );
  let reqCount = 0;
  let resCount = 0;
  const touchedResources = new Set();

  for (let ei = 0; ei < events.length; ei += 1) {
    const ev = events[ei];
    const wanted = 8 + (ei % 5); // 8..12 requirements per event
    const already = existingPerEvent.get(String(ev._id)) || 0;
    let created = 0;
    const target = Math.max(0, wanted - already);
    let probe = 0;
    while (created < target && probe < resources.length * 2) {
      const res = resources[(ei * 13 + probe * 5) % resources.length];
      probe += 1;
      const key = `${ev._id}:${res._id}`;
      const used = usage.get(String(res._id)) || 0;
      if (haveKeys.has(key) || used >= MAX_USES_PER_RESOURCE) continue;
      haveKeys.add(key);
      usage.set(String(res._id), used + 1);

      const total = res.quantityTotal || 1;
      const quantity = Math.max(1, Math.min(total, Math.round(total * FRACTIONS[created % FRACTIONS.length])));
      const status = REQ_STATUS[(ei + created) % REQ_STATUS.length];
      const requiredDate = new Date(ev.startDate.getTime() - 24 * 60 * 60 * 1000);

      const requirement = await ResourceRequirement.create({
        event: ev._id,
        resource: res._id,
        quantity,
        requiredDate,
        priority: PRIORITIES[(ei + created) % PRIORITIES.length],
        status,
        notes: `Seeded requirement for ${ev.name}`,
      });
      reqCount += 1;
      created += 1;

      // Turn most requirements into actual reservations (pending stays empty).
      let reservationQty = 0;
      let reservationStatus = null;
      if (status === 'partially_reserved') {
        reservationQty = Math.max(1, Math.floor(quantity / 2));
        reservationStatus = 'reserved';
      } else if (status === 'reserved') {
        reservationQty = quantity;
        reservationStatus = 'reserved';
      } else if (status === 'fulfilled') {
        reservationQty = quantity;
        reservationStatus = 'returned';
      }

      if (reservationQty > 0) {
        // Never hold more stock than actually exists — capped active holds keep
        // availability (total - reserved) from ever going negative.
        const resourceKey = String(res._id);
        if (ACTIVE_RESERVATION_STATUSES.includes(reservationStatus)) {
          const capped = Math.min(reservationQty, remainingStock.get(resourceKey) || 0);
          if (capped !== reservationQty) {
            // Not enough stock left: downgrade the requirement to match the smaller hold.
            reservationQty = capped;
            requirement.status = capped > 0 ? 'partially_reserved' : 'pending';
            await requirement.save();
          }
          if (reservationQty > 0) {
            remainingStock.set(resourceKey, (remainingStock.get(resourceKey) || 0) - reservationQty);
          } else {
            reservationStatus = null;
          }
        }
        if (reservationQty > 0 && reservationStatus) {
          const reservedFrom = new Date(ev.startDate.getTime() - 24 * 60 * 60 * 1000);
          const endDate = ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
          const reservedUntil = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
          await ResourceReservation.create({
            event: ev._id,
            requirement: requirement._id,
            resource: res._id,
            quantity: reservationQty,
            reservedFrom,
            reservedUntil,
            status: reservationStatus,
            notes: `Seeded reservation for ${ev.name}`,
          });
          resCount += 1;
          if (ACTIVE_RESERVATION_STATUSES.includes(reservationStatus)) {
            touchedResources.add(String(res._id));
          }
        }
      }
    }
  }

  // Keep quantityAvailable consistent with active reservations for touched resources.
  for (const rid of touchedResources) {
    const active = await ResourceReservation.find({ resource: rid, status: { $in: ACTIVE_RESERVATION_STATUSES } }).select('quantity');
    const reserved = active.reduce((sum, r) => sum + r.quantity, 0);
    const resource = await Resource.findById(rid).select('quantityTotal');
    if (resource) {
      resource.quantityAvailable = Math.max(0, (resource.quantityTotal || 0) - reserved);
      await resource.save();
    }
  }

  // --- guaranteed resource shortages: quantity > total stock ---
  const resourceByName = new Map(resources.map((r) => [r.name, r]));
  const eventByName = new Map(events.map((e) => [e.name, e]));
  let shortageCount = 0;
  for (const [eventName, resourceName, quantity] of SHORTAGE_REQS) {
    const sev = eventByName.get(eventName);
    const sres = resourceByName.get(resourceName);
    if (!sev || !sres) continue;
    const existingReq = await ResourceRequirement.findOne({ event: sev._id, resource: sres._id });
    if (existingReq) {
      if (existingReq.quantity < quantity) {
        existingReq.quantity = quantity;
        existingReq.priority = 'high';
        await existingReq.save();
        shortageCount += 1;
      }
      continue;
    }
    await ResourceRequirement.create({
      event: sev._id,
      resource: sres._id,
      quantity,
      requiredDate: new Date(sev.startDate.getTime() - 24 * 60 * 60 * 1000),
      priority: 'high',
      status: 'pending',
      notes: 'Seeded shortage: quantity exceeds total stock',
    });
    shortageCount += 1;
  }

  // --- booking requests for every event that does not have one yet ---
  const bookedEventIds = new Set(
    (await Booking.find({ eventId: { $in: events.map((e) => e._id) } }).select('eventId')).map((b) => String(b.eventId))
  );
  const bookingDocs = [];
  events.forEach((evt, idx) => {
    if (bookedEventIds.has(String(evt._id))) return;
    const bookerId = evt.bookerId || defaultBookerId;
    if (!bookerId) return;
    let status = BOOKING_CYCLE[idx % BOOKING_CYCLE.length];
    if (evt.status === 'completed') status = 'Completed';
    else if (evt.status === 'cancelled') status = 'Cancelled';
    const doc = {
      eventId: evt._id,
      bookerId,
      status,
      notes: 'Seeded booking request',
      createdAt: new Date(Date.now() - ((idx % 28) + 2) * 24 * 60 * 60 * 1000),
    };
    if (status === 'Rejected') doc.rejectionReason = 'Seeded: budget exceeded for this request.';
    bookingDocs.push(doc);
  });
  let bookingCount = 0;
  if (bookingDocs.length) {
    await Booking.insertMany(bookingDocs);
    bookingCount = bookingDocs.length;
  }

  const [orgs, venues, res, reqs, reservations, users, eventTotal, bookings] = await Promise.all([
    Organization.countDocuments(),
    Venue.countDocuments(),
    Resource.countDocuments(),
    ResourceRequirement.countDocuments(),
    ResourceReservation.countDocuments(),
    User.countDocuments(),
    Event.countDocuments(),
    Booking.countDocuments(),
  ]);
  console.log('Seed complete:');
  console.log(`  organizations: ${orgs}  (+${newOrgs.length} new)`);
  console.log(`  users:         ${users}  (+${newUserDocs.length} new)`);
  console.log(`  venues:        ${venues}  (+${newVenues.length} new)`);
  console.log(`  resources:     ${res}  (+${newResources.length} new)`);
  console.log(`  events:        ${eventTotal}  (+${newEventDefs.length} new)`);
  console.log(`  requirements:  ${reqs}  (+${reqCount + shortageCount} new)`);
  console.log(`  reservations:  ${reservations}  (+${resCount} new)`);
  console.log(`  bookings:      ${bookings}  (+${bookingCount} new)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
