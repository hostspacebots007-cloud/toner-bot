// Add new imports for PDF generation and API calls
const express = require("express");
const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require("./whatsapp-bot-2-472016-firebase-adminsdk-fb8c0.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

// === NEW: PDF Generation Function ===
async function generateQuotePdf(productData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    let buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });
    doc.on("error", (error) => reject(error));

    // Add content to the PDF
    doc.fontSize(25).text("Product Quote", { align: "center" });
    doc.moveDown();
    doc.fontSize(18).text(`Product: ${productData.name}`);
    doc.moveDown();
    doc.fontSize(14).text(`Description: ${productData.description}`);
    doc.moveDown();
    doc.fontSize(14).text(`Price: $${productData.price}`);
    doc.moveDown();
    doc.text("Thank you for your interest!");

    doc.end();
  });
}

// === NEW: WhatsApp API Function ===
async function sendPdfToWhatsApp(phoneNumberId, to, pdfBuffer) {
  const token = process.env.META_ACCESS_TOKEN; // You need to store your access token as an environment variable
  const metaApiUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('to', to);
  formData.append('type', 'document');
  formData.append('document', new Blob([pdfBuffer], { type: 'application/pdf' }), 'Quote.pdf');
  formData.append('caption', 'Your product quote is here!');

  try {
    const response = await axios.post(metaApiUrl, formData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData.getHeaders()
      }
    });
    console.log('PDF sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending PDF to WhatsApp:', error.response ? error.response.data : error.message);
  }
}

// === Updated: WhatsApp Webhook Route ===
app.post("/meta-webhook", async (req, res) => {
  try {
    const messageData = req.body;
    const incomingMessage = messageData.entry[0].changes[0].value.messages[0];

    // Check if the message is a text message and the text is "quote"
    if (incomingMessage && incomingMessage.type === "text" && incomingMessage.text.body.toLowerCase().trim() === "quote") {
      
      const sku = "example-sku-123"; // You will need a way to determine the correct SKU here
      
      const productRef = firestore.collection('products').doc(sku);
      const doc = await productRef.get();

      if (doc.exists) {
        const productData = doc.data();
        const pdfBuffer = await generateQuotePdf(productData);

        // Get the phone number of the sender
        const customerPhoneNumber = incomingMessage.from; 

        // Get your WhatsApp Business phone number ID (from Meta Developer Dashboard)
        const yourPhoneNumberId = "YOUR_WHATSAPP_PHONE_NUMBER_ID"; 

        // Send the generated PDF back to the customer
        await sendPdfToWhatsApp(yourPhoneNumberId, customerPhoneNumber, pdfBuffer);
        
        console.log("PDF quote generated and sent.");
        res.status(200).send("Quote request processed.");
      } else {
        res.status(404).send("Product not found.");
      }

    } else {
      // If it's not a quote request, just send an OK response
      res.status(200).send("OK");
    }
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(500).send("Error handling webhook.");
  }
});

// Route to get product data from Firestore (from your previous code)
app.get("/product/:sku", async (req, res) => {
  const sku = req.params.sku;
  try {
    const productRef = firestore.collection("products").doc(sku);
    const doc = await productRef.get();
    if (!doc.exists) {
      return res.status(404).send("Product not found.");
    }
    res.status(200).json(doc.data());
  } catch (error) {
    console.error("Error getting product:", error);
    res.status(500).send("Error retrieving product data.");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
