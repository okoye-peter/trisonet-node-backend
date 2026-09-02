import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import { COMPANY_DETAILS } from '../config/constants.js';
import { TermiiService } from './termii.service.js';
import { getSetting } from './setting.service.js';

// Shared with the PHP app via the `settings` table (both apps read the same DB) -
// lets an admin flip ALL outgoing email between Termii and Zoho from the settings
// screen. See TermiiSmsTrait::mailProvider() on the PHP side.
const getMailProvider = () => getSetting('mail_provider').then(v => v || 'termii');

const transporter = nodemailer.createTransport({
    host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
    port: Number(process.env.ZOHO_SMTP_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.ZOHO_EMAIL,
        pass: process.env.ZOHO_APP_PASSWORD,
    },
});

const wrapInLayout = (bodyHtml: string) => `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h2 style="margin: 0 0 16px; color: #0f766e;">${COMPANY_DETAILS.NAME}</h2>
    ${bodyHtml}
    <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">
        This is an automated message from ${COMPANY_DETAILS.NAME}. If you did not expect this email, please ignore it or contact us at ${COMPANY_DETAILS.EMAIL}.
    </p>
</div>`;

const otpEmailTemplate = (code: string) => wrapInLayout(`
    <p>Your verification code is:</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">${code}</p>
    <p>This code will expire shortly. Do not share it with anyone.</p>
`);

const pukEmailTemplate = (code: string) => wrapInLayout(`
    <p>Your PUK code to reactivate your ${COMPANY_DETAILS.NAME} account is:</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">${code}</p>
    <p>Enter this code on the reactivation screen to unblock your account. It stays valid until you use it. Do not share it with anyone.</p>
`);

const welcomeEmailTemplate = (name: string, email: string, password: string, intro: string) => wrapInLayout(`
    <p>Hi ${name},</p>
    <p>${intro}</p>
    <table style="margin: 16px 0; border-collapse: collapse;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Email</td><td>${email}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Password</td><td>${password}</td></tr>
    </table>
    <p>We recommend changing your password after logging in.</p>
`);

export class EmailService {
    public static async sendOtpEmail(email: string, code: string): Promise<boolean> {
        if (await getMailProvider() === 'termii') {
            const result = await TermiiService.sendEmailOtp(email, code);
            return result.status;
        }

        try {
            await transporter.sendMail({
                from: `"${COMPANY_DETAILS.NAME}" <${process.env.ZOHO_EMAIL}>`,
                to: email,
                subject: 'Your Verification Code',
                html: otpEmailTemplate(code),
            });
            return true;
        } catch (error) {
            logger.error('zoho otp email error', { email, error });
            return false;
        }
    }

    // A PUK is not an OTP: it stays valid until it is used. Termii's shared OTP template
    // hard-codes "verification code ... expires in 10 minutes", which is wrong on both
    // counts, so prefer a PUK-specific template when one is configured.
    public static async sendPukEmail(email: string, code: string): Promise<boolean> {
        if (await getMailProvider() === 'termii') {
            if (process.env.TERMII_PUK_TEMPLATE_ID) {
                const result = await TermiiService.sendTemplateEmail(
                    email,
                    `Your ${COMPANY_DETAILS.NAME} PUK code`,
                    { code },
                    process.env.TERMII_PUK_TEMPLATE_ID
                );
                return result.status;
            }

            // No PUK template configured - fall back to the OTP path so the code still
            // reaches the user, even though the wording will be the generic one.
            logger.warn('TERMII_PUK_TEMPLATE_ID not set, falling back to generic OTP email template', { email });
            const result = await TermiiService.sendEmailOtp(email, code);
            return result.status;
        }

        try {
            await transporter.sendMail({
                from: `"${COMPANY_DETAILS.NAME}" <${process.env.ZOHO_EMAIL}>`,
                to: email,
                subject: `Your ${COMPANY_DETAILS.NAME} PUK code`,
                html: pukEmailTemplate(code),
            });
            return true;
        } catch (error) {
            logger.error('zoho puk email error', { email, error });
            return false;
        }
    }

    public static async sendWelcomeEmail(email: string, name: string, password: string, intro: string): Promise<boolean> {
        if (await getMailProvider() === 'termii') {
            const result = await TermiiService.sendTemplateEmail(
                email,
                `Welcome to ${COMPANY_DETAILS.NAME}`,
                { name, email, password, intro },
                process.env.TERMII_WELCOME_TEMPLATE_ID
            );
            return result.status;
        }

        try {
            await transporter.sendMail({
                from: `"${COMPANY_DETAILS.NAME}" <${process.env.ZOHO_EMAIL}>`,
                to: email,
                subject: `Welcome to ${COMPANY_DETAILS.NAME}`,
                html: welcomeEmailTemplate(name, email, password, intro),
            });
            return true;
        } catch (error) {
            logger.error('zoho welcome email error', { email, error });
            return false;
        }
    }
}
