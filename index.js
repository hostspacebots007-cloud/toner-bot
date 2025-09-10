require('dotenv').config(); // Load environment variables

const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { Client } = require('pg');
const Fonoster = require('@fonoster/sdk');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

// PostgreSQL setup
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

dbClient.connect()
  .then(() => console.log('Database connected successfully'))
  .catch(err => console.error('Database connection error:', err.stack));

// Twilio setup
const { MessagingResponse } = twilio.twiml;
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Fonoster setup
const fonosterClient = new Fonoster.Client({
  accessKeyId: process.env.FONOSTER_ACCESS_KEY,
  accessKeySecret: process.env.FONOSTER_ACCESS_SECRET
});

// Toner search logic
async function findTonerCode(query) {
  const cleanedQuery = query.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const sqlQuery = `
    SELECT * FROM toner_products
    WHERE LOWER(REPLACE(REPLACE(product_code, '-', ''), ' ', '')) LIKE $1
  `;
  const values = [`%${cleanedQuery}%`];

  try {
    const res = await dbClient.query(sqlQuery, values);
    return res.rows[0] || null;
  } catch (error) {
    console.error('Error finding toner:', error);
    return null;
  }
}

// WhatsApp endpoint
app.post('/whatsapp', async (req, res) => {
  const incomingMsg = req.body.Body.trim();
  const toner = await findTonerCode(incomingMsg);

  const responseMsg = toner
    ? `Product: ${toner.product_name}
Code: ${toner.product_code}
Manufacturer: ${toner.manufacturer}
Price: R ${parseFloat(toner.unit_price).toFixed(2)}
In Stock: ${toner.quantity_in_stock}
Status: ${toner.status}`
    : `Sorry, I couldn't find that toner code. Please try again.`;

  // Choose provider
  const useFonoster = process.env.USE_FONOSTER === 'true';

  if (useFonoster) {
    // Placeholder: Fonoster message logic goes here
    console.log('Fonoster would send:', responseMsg);
    res.send('Fonoster integration placeholder');
  } else {
    const twiml = new MessagingResponse();
    twiml.message(responseMsg);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Bot running on port ${port}`);
});
