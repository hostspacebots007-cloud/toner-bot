const express = require('express');
const twilio = require('twilio');
require('dotenv').config();
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Business name (easily customizable)
const BUSINESS_NAME = "TechSupplies";
const BUSINESS_INITIALS = "TS";
const BUSINESS_ADDRESS = "123 Tech Street, Tech City, TC 12345";
const BUSINESS_PHONE = "+1 (555) 123-4567";
const BUSINESS_EMAIL = "info@techsupplies.com";

// Initialize Twilio client if credentials exist
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Session management (in production, use Redis or similar)
let userSessions = new Map();

// Twilio API function
async function sendViaTwilio(to, message) {
  if (!twilioClient) {
    throw new Error("Twilio credentials not configured");
  }
  
  try {
    const result = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${to}`,
      body: message
    });
    console.log("✅ Twilio success:", result.sid);
    return result;
  } catch (error) {
    console.error("❌ Twilio error:", error.message);
    throw error;
  }
}

// Message sender function
async function sendWhatsAppMessage(to, message) {
  try {
    console.log(`Sending message via Twilio...`);
    const result = await sendViaTwilio(to, message);
    console.log(`✅ Message sent via Twilio`);
    return { success: true, provider: 'Twilio', result };
  } catch (error) {
    console.error("❌ Twilio failed:", error.message);
    throw error;
  }
}

// Generate PDF Quote
async function generateQuotePDF(customerName, items, total, quoteNumber) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document
      const doc = new PDFDocument();
      const pdfPath = path.join(__dirname, 'quotes', `quote-${quoteNumber}.pdf`);
      const pdfDir = path.dirname(pdfPath);
      
      // Ensure quotes directory exists
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }
      
      // Create write stream
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);
      
      // Add header
      doc.fontSize(20).font('Helvetica-Bold').text(BUSINESS_NAME, 50, 50);
      doc.fontSize(10).font('Helvetica').text(BUSINESS_ADDRESS, 50, 75);
      doc.text(`Phone: ${BUSINESS_PHONE} | Email: ${BUSINESS_EMAIL}`, 50, 90);
      
      // Add quote title and details
      doc.fontSize(16).font('Helvetica-Bold').text('QUOTATION', 50, 130);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Quote Number: ${quoteNumber}`, 50, 160);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 50, 175);
      doc.text(`Customer: ${customerName}`, 50, 190);
      doc.text(`Valid Until: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, 50, 205);
      
      // Add table header
      doc.font('Helvetica-Bold');
      doc.text('Description', 50, 240);
      doc.text('Quantity', 250, 240);
      doc.text('Unit Price', 350, 240);
      doc.text('Total', 450, 240);
      
      // Add items
      let yPosition = 260;
      doc.font('Helvetica');
      
      items.forEach((item, index) => {
        if (yPosition > 700) {
          doc.addPage();
          yPosition = 50;
        }
        
        doc.text(item.name, 50, yPosition);
        doc.text(item.quantity.toString(), 250, yPosition);
        doc.text(`$${item.unitPrice.toFixed(2)}`, 350, yPosition);
        doc.text(`$${item.total.toFixed(2)}`, 450, yPosition);
        
        yPosition += 20;
      });
      
      // Add total
      yPosition += 20;
      doc.font('Helvetica-Bold');
      doc.text('GRAND TOTAL:', 350, yPosition);
      doc.text(`$${total.toFixed(2)}`, 450, yPosition);
      
      // Add footer
      doc.fontSize(8).font('Helvetica');
      doc.text('Thank you for your business!', 50, 750);
      doc.text('Terms: Net 30 days | Prices subject to change without notice', 50, 765);
      
      // Finalize PDF
      doc.end();
      
      stream.on('finish', () => {
        console.log(`PDF generated: ${pdfPath}`);
        resolve(pdfPath);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to get or create user session
function getUserSession(from) {
  if (!userSessions.has(from)) {
    userSessions.set(from, {
      cart: [],
      quotePending: false,
      customerName: '',
      lastActivity: Date.now(),
      quoteItems: []
    });
  }
  return userSessions.get(from);
}

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  for (const [from, session] of userSessions.entries()) {
    if (now - session.lastActivity > twoHours) {
      userSessions.delete(from);
      console.log(`Cleaned up session for ${from}`);
    }
  }
}, 30 * 60 * 1000); // Run every 30 minutes

// Find product in database
async function findProduct(productCode) {
  try {
    const res = await pool.query(
      'SELECT * FROM products WHERE LOWER(product_code) = LOWER($1)',
      [productCode]
    );
    return res.rows[0];
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

// Get all products for quote
async function getAllProducts() {
  try {
    const res = await pool.query(
      'SELECT product_name, product_code, unit_price FROM products ORDER BY product_name'
    );
    return res.rows;
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

// Send menu message
async function sendMenuMessage(to) {
  const message = `Hello! Welcome to ${BUSINESS_NAME}. 🛍️\nWhat would you like to do?\n*1* - Browse available products\n*2* - Check my cart\n*3* - Place order\n*4* - Speak to customer service\n*quote* - Generate a quote`;
  
  try {
    await sendWhatsAppMessage(to, message);
  } catch (error) {
    console.error("Failed to send menu message:", error);
  }
}

// API endpoint to send simple messages
app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: "Missing required parameters: to, message" });
  }
  
  try {
    const result = await sendWhatsAppMessage(to, message);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Failed to send message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// API endpoint to generate and download quote PDF
app.get('/quote/:quoteNumber', async (req, res) => {
  try {
    const quoteNumber = req.params.quoteNumber;
    const pdfPath = path.join(__dirname, 'quotes', `quote-${quoteNumber}.pdf`);
    
    if (fs.existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=quote-${quoteNumber}.pdf`);
      
      const fileStream = fs.createReadStream(pdfPath);
      fileStream.pipe(res);
    } else {
      res.status(404).json({ error: 'Quote not found' });
    }
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// WhatsApp webhook endpoint
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || req.body.from;
  const incomingMsg = (req.body.Body || req.body.body || '').trim();
  const lowerMsg = incomingMsg.toLowerCase();
  
  if (!from) {
    return res.status(400).send("Missing sender information");
  }
  
  // Handle Twilio status callbacks
  if (req.body && req.body.SmsStatus) {
    console.log('Twilio status callback:', req.body.SmsStatus);
    return res.status(200).send('OK');
  }
  
  // Get user session
  const session = getUserSession(from);
  session.lastActivity = Date.now();
  
  try {
    if (['hello', 'hi', 'start'].includes(lowerMsg)) {
      await sendMenuMessage(from);
      res.status(200).send("OK");
    } 
    else if (lowerMsg === '1') {
      // Browse products
      const result = await pool.query('SELECT product_name, product_code, unit_price FROM products ORDER BY product_name');
      let message = `Here are our available products and prices:\n`;
      result.rows.forEach(row => {
        message += `\n- ${row.product_name} (${row.product_code}): $${parseFloat(row.unit_price).toFixed(2)}`;
      });
      message += "\n\nReply with the product code to add it to your cart.";
      await sendWhatsAppMessage(from, message);
      res.status(200).send("OK");
    } 
    else if (lowerMsg === '2') {
      // Check cart
      if (session.cart.length === 0) {
        await sendWhatsAppMessage(from, "Your cart is empty. Reply *1* to browse products.");
      } else {
        const items = [];
        let total = 0;
        for (const code of session.cart) {
          const product = await findProduct(code);
          if (product) {
            const emoji = product.quantity_in_stock > 0 ? '🟢' : '🔴';
            items.push(`${emoji} ${product.product_name}`);
            total += parseFloat(product.unit_price);
          }
        }
        await sendWhatsAppMessage(from, `Your Cart 🛒:\nItems: ${items.join(', ')}\nTotal: $${total.toFixed(2)}\n\nReply *3* to place your order.`);
      }
      res.status(200).send("OK");
    } 
    else if (lowerMsg === '3') {
      // Place order
      if (session.cart.length === 0) {
        await sendWhatsAppMessage(from, "Your cart is empty. Can't place an order.");
      } else {
        const items = [];
        let total = 0;
        for (const code of session.cart) {
          const product = await findProduct(code);
          if (product) {
            items.push(product.product_name);
            total += parseFloat(product.unit_price);
          }
        }
        await sendWhatsAppMessage(from, `ORDER CONFIRMED! ✅\n\nItems: ${items.join(', ')}\nTotal Amount Due: $${total.toFixed(2)}\n\nPlease proceed with payment as discussed. Include your name as a reference. Thank you!`);
        session.cart = [];
      }
      res.status(200).send("OK");
    } 
    else if (lowerMsg === '4') {
      // Speak to customer service
      await sendWhatsAppMessage(from, "A customer service representative will contact you shortly. Thank you for your patience.");
      res.status(200).send("OK");
    } 
    else if (lowerMsg === 'quote') {
      // Start quote process
      session.quotePending = true;
      session.quoteItems = [];
      const products = await getAllProducts();
      
      let message = `Let's create your quote! 📋\n\nAvailable products:\n`;
      products.forEach((product, index) => {
        message += `\n${index + 1}. ${product.product_name} (${product.product_code}): $${parseFloat(product.unit_price).toFixed(2)}`;
      });
      
      message += `\n\nPlease reply with product numbers and quantities like this:\n"1x2, 3x1, 5x4" (product 1 x2, product 3 x1, product 5 x4)`;
      
      await sendWhatsAppMessage(from, message);
      res.status(200).send("OK");
    } 
    else if (session.quotePending) {
      // Process quote items
      try {
        const products = await getAllProducts();
        const itemsPattern = /(\d+)x(\d+)/g;
        let match;
        let total = 0;
        
        while ((match = itemsPattern.exec(incomingMsg)) !== null) {
          const productIndex = parseInt(match[1]) - 1;
          const quantity = parseInt(match[2]);
          
          if (productIndex >= 0 && productIndex < products.length && quantity > 0) {
            const product = products[productIndex];
            const itemTotal = parseFloat(product.unit_price) * quantity;
            
            session.quoteItems.push({
              name: product.product_name,
              code: product.product_code,
              quantity: quantity,
              unitPrice: parseFloat(product.unit_price),
              total: itemTotal
            });
            
            total += itemTotal;
          }
        }
        
        if (session.quoteItems.length > 0) {
          // Generate quote number
          const quoteNumber = `QT${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
          
          // Generate PDF
          const pdfPath = await generateQuotePDF(from, session.quoteItems, total, quoteNumber);
          
          await sendWhatsAppMessage(from, `✅ Quote generated!\n\nTotal: $${total.toFixed(2)}\nQuote Number: ${quoteNumber}\n\nDownload your quote: https://toner-bot-tuqp.onrender.com/quote/${quoteNumber}\n\nThank you for your inquiry!`);
          
          // Reset quote session
          session.quotePending = false;
          session.quoteItems = [];
        } else {
          await sendWhatsAppMessage(from, "I couldn't understand your product selection. Please use the format: '1x2, 3x1' etc.");
        }
        
        res.status(200).send("OK");
      } catch (error) {
        console.error('Error processing quote:', error);
        await sendWhatsAppMessage(from, "Sorry, there was an error processing your quote. Please try again.");
        res.status(200).send("OK");
      }
    } 
    else {
      // Assume it's a product code
      const product = await findProduct(incomingMsg);
      if (product) {
        session.cart.push(product.product_code);
        await sendWhatsAppMessage(from, `Added *${product.product_name}* to your cart. 🛒\n\nReply *2* to view cart or *1* to browse more.`);
      } else {
        await sendWhatsAppMessage(from, `I didn't understand that. Please reply with *1*, *2*, *3*, *4*, or *quote*.`);
      }
      res.status(200).send("OK");
    }
  } catch (error) {
    console.error('Error processing message:', error);
    try {
      await sendWhatsAppMessage(from, "Sorry, an error occurred. Please try again later.");
    } catch (sendError) {
      console.error('Also failed to send error message:', sendError);
    }
    res.status(500).send("Error processing message");
  }
});

// Add GET endpoint for webhook verification
app.get('/whatsapp', (req, res) => {
  // Handle Twilio webhook verification
  if (req.query && req.query['hub.challenge']) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  
  res.status(200).send('WhatsApp webhook is active');
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      message: `${BUSINESS_NAME} WhatsApp bot is running`,
      provider: 'Twilio'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'Disconnected',
      error: error.message 
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`${BUSINESS_NAME} WhatsApp bot running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  
  // Create quotes directory if it doesn't exist
  const quotesDir = path.join(__dirname, 'quotes');
  if (!fs.existsSync(quotesDir)) {
    fs.mkdirSync(quotesDir, { recursive: true });
    console.log('Created quotes directory');
  }
});

module.exports = app;