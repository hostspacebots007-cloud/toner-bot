const express = require('express');
const twilio = require('twilio');
require('dotenv').config();
const { Pool } = require('pg');

const app = express();
app.use(express.urlencoded({ extended: true }));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let cart = [];
let quotePending = false;
let customerName = '';

async function findToner(productCode) {
  const res = await pool.query(
    'SELECT * FROM toner_products WHERE LOWER(product_code) = LOWER($1)',
    [productCode]
  );
  return res.rows[0];
}

app.post('/whatsapp', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const incomingMsg = req.body.Body.trim();
  const lowerMsg = incomingMsg.toLowerCase();

  try {
    if (['hello', 'hi', 'start'].includes(lowerMsg)) {
      twiml.message(`Hello! Welcome to RailToner. 🖨️\nWhat would you like to do?\n*1* - Browse available toners\n*2* - Check my cart\n*3* - Place order\n*4* - Speak to a human\n*quote* - Generate a PDF quote`);
    } else if (lowerMsg === '1') {
      const result = await pool.query('SELECT product_name, product_code, unit_price FROM toner_products ORDER BY product_name');
      let message = "Here are our available toners and prices (BWP):\n";
      result.rows.forEach(row => {
        message += `\n- ${row.product_name} (${row.product_code}): P${parseFloat(row.unit_price).toFixed(2)}`;
      });
      message += "\n\nReply with the toner code (e.g., 'TN 2355') to add it to your cart.";
      twiml.message(message);
    } else if (lowerMsg === '2') {
      if (cart.length === 0) {
        twiml.message("Your cart is empty. Reply *1* to browse toners.");
      } else {
        const items = [];
        let total = 0;
        for (const code of cart) {
          const toner = await findToner(code);
          if (toner) {
            const emoji = toner.quantity_in_stock > 0 ? '🟢' : '🔴';
            items.push(`${emoji} ${toner.product_name}`);
            total += parseFloat(toner.unit_price);
          }
        }
        twiml.message(`Your Cart 🛒:\nItems: ${items.join(', ')}\nTotal: P${total.toFixed(2)}\n\nReply *3* to place your order.`);
      }
    } else if (lowerMsg === '3') {
      if (cart.length === 0) {
        twiml.message("Your cart is empty. Can't place an order.");
      } else {
        const items = [];
        let total = 0;
        for (const code of cart) {
          const toner = await findToner(code);
          if (toner) {
            items.push(toner.product_name);
            total += parseFloat(toner.unit_price);
          }
        }
        twiml.message(`ORDER CONFIRMED! ✅\n\nItems: ${items.join(', ')}\nTotal Amount Due: P${total.toFixed(2)}\n\nPlease send *${total} BWP* via Orange Money or Masisi to +267 XXX-XXXX. Include your name as a reference. We will deliver to your office at the railway. Thank you!`);
        cart = [];
      }
    } else if (lowerMsg === '4') {
      twiml.message("A customer service representative will contact you shortly. Thank you for your patience.");
    } else if (lowerMsg === 'quote') {
      quotePending = true;
      twiml.message("Please enter your name for the quote.");
    } else if (quotePending) {
      customerName = incomingMsg;
      quotePending = false;

      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument();
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', async () => {
        const pdfData = Buffer.concat(buffers);
        twiml.message(`Quote generated for ${customerName}. (PDF delivery coming soon!)`);
        res.set('Content-Type', 'text/xml');
        res.send(twiml.toString());
      });

      doc.fontSize(18).text('RailToner Quote', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Customer: ${customerName}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      doc.moveDown();

      doc.text('Items:');
      let total = 0;
      for (const code of cart) {
        const toner = await findToner(code);
        if (toner) {
          const emoji = toner.quantity_in_stock > 0 ? '🟢' : '🔴';
          doc.text(`- ${emoji} ${toner.product_name}: P${parseFloat(toner.unit_price).toFixed(2)}`);
          total += parseFloat(toner.unit_price);
        }
      }

      doc.moveDown();
      doc.text(`Total: P${total.toFixed(2)}`);
      doc.text(`Payment: Send ${total.toFixed(2)} BWP via Orange Money or Masisi to +267 XXX-XXXX`);
      doc.end();
      return;
    } else {
      const toner = await findToner(incomingMsg);
      if (toner) {
        cart.push(toner.product_code);
        twiml.message(`Added *${toner.product_name}* to your cart. 🛒\n\nReply *2* to view cart or *1* to browse more.`);
      } else {
        twiml.message(`I didn't understand that. Please reply with *1*, *2*, *3*, *4*, or *quote*.`);
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    twiml.message("Sorry, an error occurred. Please try again later.");
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => {
  res.send('🤖 Toner Bot WhatsApp Bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
