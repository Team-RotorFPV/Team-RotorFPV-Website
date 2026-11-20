import crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { hashToken } from './tokenHash.js';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generates a secure token, hashes it, stores it in Firestore, and sends an email.
 * @param {string} email - The email to send the verification link to.
 * @param {string} type - 'onboarding' or 'migration'
 * @param {object} metadata - Additional data (e.g., tags, permissions, oldEmail).
 * @returns {Promise<void>}
 */
export async function sendVerificationEmail(email, type, metadata = {}) {
  const db = getFirestore();
  
  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(token);
  
  // Expiration: 24 hours from now
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  // Store hashed token in Firestore
  await db.collection('verification_tokens').add({
    hashedToken,
    email: email.toLowerCase(),
    type,
    metadata,
    expiresAt,
    createdAt: new Date(),
    used: false
  });

  // Construct verification URL
  // We use the backend URL for the verification link so it handles it directly
  // We check multiple common environment variables for auto-detecting the production URL
  const apiUrl = process.env.SERVER_URL || 
                 process.env.BACKEND_URL || 
                 process.env.RENDER_EXTERNAL_URL || 
                 (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) || 
                 (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
                 'http://localhost:3000';
                 
  const backendVerifyUrl = `${apiUrl}/api/verify?token=${token}`;

  let subject = '';
  let html = '';

  if (type === 'onboarding') {
    subject = 'Verify your email to join Team Rotor';
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #64ffda;">Welcome to Team Rotor!</h2>
        <p>Your team request has been approved by an administrator.</p>
        <p>Please click the link below to verify your email address and activate your account:</p>
        <p style="margin: 30px 0;">
          <a href="${backendVerifyUrl}" style="background-color: #64ffda; color: #0a192f; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Verify Email Address</a>
        </p>
        <p style="color: #8892b0; font-size: 0.9em;">This link will expire in 24 hours.</p>
        <p style="color: #8892b0; font-size: 0.8em; margin-top: 40px;">If the button doesn't work, copy and paste this link: ${backendVerifyUrl}</p>
      </div>
    `;
  } else if (type === 'migration') {
    subject = 'Verify your new email for Team Rotor';
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #64ffda;">Email Migration Requested</h2>
        <p>You requested to migrate your Team Rotor account to this email address.</p>
        <p>Please click the link below to confirm this action:</p>
        <p style="margin: 30px 0;">
          <a href="${backendVerifyUrl}" style="background-color: #64ffda; color: #0a192f; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Confirm Email Migration</a>
        </p>
        <p style="color: #8892b0; font-size: 0.9em;">This link will expire in 24 hours.</p>
        <p style="color: #8892b0; font-size: 0.8em; margin-top: 40px;">If the button doesn't work, copy and paste this link: ${backendVerifyUrl}</p>
      </div>
    `;
  }

  // Fallback to contact@teamrotorfpv.com if a custom domain is not explicitly set
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Team Rotor <contact@teamrotorfpv.com>';

  if (process.env.RESEND_API_KEY) {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject,
      html
    });

    if (error) {
      console.error("Resend API Error (Verification Email):", error.message || error);
      throw new Error("Failed to send verification email due to a mail server error.");
    }
  } else {
    console.error("RESEND_API_KEY not set! Cannot send verification email.");
    throw new Error("Mail server is not configured.");
  }
}

// Token checking and use live in verifyFlow.js.
