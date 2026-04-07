const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
  port: Number(process.env.ZOHO_SMTP_PORT || 465),
  secure: String(process.env.ZOHO_SMTP_SECURE || 'true') === 'true',
  auth: {
    user: process.env.ZOHO_SMTP_USER,
    pass: process.env.ZOHO_SMTP_PASS
  },
  logger: String(process.env.SMTP_DEBUG || 'false').toLowerCase() === 'true',
  debug: String(process.env.SMTP_DEBUG || 'false').toLowerCase() === 'true'
});

let verified = false;

async function ensureVerified() {
  if (verified) return;
  await transporter.verify();
  verified = true;
}

async function sendMail({ to, subject, text, html }) {
  if (!process.env.ZOHO_SMTP_USER || !process.env.ZOHO_SMTP_PASS) {
    throw new Error('SMTP not configured');
  }
  const from = process.env.FROM_EMAIL || process.env.ZOHO_SMTP_USER;
  await ensureVerified();
  return transporter.sendMail({ from, to, subject, text, html });
}

module.exports = { sendMail };
