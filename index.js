const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { Client } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

// Initialize the PostgreSQL client
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

dbClient.connect();

async function findTonerCode(query) {
  // Use a case-insensitive search with a simple pattern match
  const sqlQuery = `SELECT * FROM toner_products WHERE product_code ILIKE $1;`;
  const values = [`%${query}%`];
  
  try {
    const res = await dbClient.query(sqlQuery, values);
    return res.rows[0] || null; // Return the first matching row or null
  } catch (error) {
    console.error('Error finding toner:', error);
    return null;
  }
}

// Corrected Twilio import and usage
const { MessagingResponse } = require('twilio').twiml;

app.post('/whatsapp', async (req, res) => {
  const incomingMsg = req.body.Body.trim();
  const twiml = new MessagingResponse(); // Corrected constructor
  
  const toner = await findTonerCode(incomingMsg);
  
  if (toner) {
    const responseMsg = `
Product: ${toner.product_name}
Code: ${toner.product_code}
Manufacturer: ${toner.manufacturer}
Price: R ${parseFloat(toner.unit_price).toFixed(2)}
In Stock: ${toner.quantity_in_stock}
Status: ${toner.status}`;

    twiml.message(responseMsg);
  } else {
    twiml.message('Sorry, I couldn\'t find that toner code. Please try again.');
  }

  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());
});

app.listen(port, () => {
  console.log(`Bot running on port ${port}`);
});