let quotePending = false;
let customerName = '';

const express = require('express');
const twilio = require('twilio');
require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

let cart = [];
// Hardcoded fallback in case Sheets API fails
const tonerPrices = {
  'HP 85A': 450,
  'HP 83X': 520,
  'Canon 728': 400,
  'Samsung MLT-D105S': 480
};

// Google Sheets helper
async function readSheetData() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'google-credentials.json'), // your JSON key file
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const spreadsheetId = '1Sqj5z6lYv5nxFPBvDBxTaRooyc2H3qdnQixR_2ojkFM'; // your actual sheet ID
  const range = 'Sheet1!A1:B'; // adjust to your sheet name and range

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return res.data.values; // array of rows
}

// WhatsApp webhook
app.post('/whatsapp', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const incomingMsg = req.body.Body.trim().toLowerCase();
  const senderId = req.body.From;

  console.log(`Received message from ${senderId}: ${incomingMsg}`);

  try {
    if (incomingMsg === 'hello' || incomingMsg === 'hi' || incomingMsg === 'start') {
      twiml.message(`Hello! Welcome to RailToner. 🖨️\nWhat would you like to do?\n*1* - Browse available toners\n*2* - Check my cart\n*3* - Place order\n*4* - Speak to a human\n*quote* - Generate a PDF quote`);
    } else if (incomingMsg === '1') {
      try {
        const rows = await readSheetData();
        let message = "Here are our available toners and prices (BWP):\n";
        rows.forEach((row, index) => {
          if (index === 0) return; // skip header
          message += `\n- ${row[0]}: P${row[1]}`;
        });
        message += "\n\nReply with the toner name (e.g., 'HP 85A') to add it to your cart.";
        twiml.message(message);
      } catch (err) {
        console.error('Error reading sheet:', err);
        // fallback to hardcoded list
        let message = "Here are our available toners and prices (BWP):\n";
        for (const [toner, price] of Object.entries(tonerPrices)) {
          message += `\n- ${toner}: P${price}`;
        }
        message += "\n\nReply with the toner name (e.g., 'HP 85A') to add it to your cart.";
        twiml.message(message);
      }
    } else if (tonerPrices[incomingMsg]) {
      cart.push(incomingMsg);
      twiml.message(`Added *${incomingMsg}* to your cart. 🛒\n\nReply *2* to view cart or *1* to browse more.`);
    } else if (incomingMsg === '2') {
      if (cart.length === 0) {
        twiml.message("Your cart is empty. Reply *1* to browse toners.");
      } else {
        const cartItems = cart.join(', ');
        const total = cart.reduce((sum, item) => sum + tonerPrices[item], 0);
        twiml.message(`Your Cart 🛒:\nItems: ${cartItems}\nTotal: P${total}\n\nReply *3* to place your order.`);
      }
    } else if (incomingMsg === '3') {
      if (cart.length === 0) {
        twiml.message("Your cart is empty. Can't place an order.");
      } else {
        const total = cart.reduce((sum, item) => sum + tonerPrices[item], 0);
        twiml.message(`ORDER CONFIRMED! ✅\n\nItems: ${cart.join(', ')}\nTotal Amount Due: P${total}\n\nPlease send *${total} BWP* via Orange Money or Masisi to +267 XXX-XXXX. Include your name as a reference. We will deliver to your office at the railway. Thank you!`);
        cart = [];
      }
    } else if (incomingMsg === '4') {
      twiml.message("A customer service representative will contact you shortly. Thank you for your patience.");
    } else if (incomingMsg === 'quote') {
      quotePending = true;
      twiml.message("Please enter your name for the quote.");
    } else if (quotePending) {
      customerName = req.body.Body.trim();
      quotePending = false;

      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument();
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', async () => {
        const pdfData = Buffer.concat(buffers);
        // Placeholder for future delivery logic
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
      cart.forEach(item => {
        doc.text(`- ${item}: P${tonerPrices[item]}`);
      });

      const total = cart.reduce((sum, item) => sum + tonerPrices[item], 0);
      doc.moveDown();
      doc.text(`Total: P${total}`);
      doc.text(`Payment: Send ${total} BWP via Orange Money or Masisi to +267 XXX-XXXX`);
      doc.end();
      return; // prevent sending twice
    } else {
      twiml.message(`I didn't understand that. Please reply with *1*, *2*, *3*, *4*, or *quote*.`);
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
