import { logger } from '../utils/logger.js';
import { countries } from 'countries-list';

export class TermiiService {
    private static apiKey = process.env.TERMII_API_KEY;
    private static senderId = process.env.TERMII_SENDER_ID || 'N-Alert';
    private static emailConfigurationId = process.env.TERMII_EMAIL_CONFIG_ID;
    // Termii's template endpoint takes the same email configuration as the OTP endpoint,
    // so fall back to it rather than requiring the id to be set twice.
    private static templateEmailConfigurationId = process.env.TERMII_TEMPLATE_EMAIL_CONFIG_ID || process.env.TERMII_EMAIL_CONFIG_ID;

    public static async sendTemplateEmail(email: string, subject: string, variables: Record<string, string>, templateId?: string) {
        if (!templateId) {
            logger.error('termii template email error: missing template id', { email, subject });
            return { status: false, error: "sorry can't mail at the moment", message: 'missing template id' };
        }

        try {
            const response = await fetch('https://api.ng.termii.com/api/templates/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    email_configuration_id: this.templateEmailConfigurationId,
                    template_id: templateId,
                    email,
                    subject,
                    variables
                })
            });

            const data: any = await response.json();

            if (response.ok && data?.code === 'ok') {
                return { status: true, data };
            }

            logger.error('termii template email error', data);
            return { status: false, error: "sorry can't mail at the moment", message: data };
        } catch (error) {
            logger.error('termii template email error', { error });
            return { status: false, error: "sorry can't mail at the moment", message: error };
        }
    }

    public static async sendEmailOtp(email: string, code: string) {
        try {
            const response = await fetch('https://api.ng.termii.com/api/email/otp/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    email_configuration_id: this.emailConfigurationId,
                    code,
                    email_address: email
                })
            });

            const data = await response.json();

            if (response.ok) {
                return { status: true, data };
            }

            logger.error('termii email error', data);
            return { status: false, error: "sorry can't mail at the moment", message: data };
        } catch (error) {
            logger.error('termii email error', { error });
            return { status: false, error: "sorry can't mail at the moment", message: error };
        }
    }

    public static async sendSms(phone: string, msg: string) {
        const { country, from, channel } = this.getCountry(phone);

        try {
            const response = await fetch('https://api.ng.termii.com/api/sms/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    to: country === 'Nigeria' ? this.formatPhoneNumber(phone) : phone,
                    from: from,
                    sms: msg,
                    type: 'plain',
                    channel: channel
                })
            });

            const data = await response.json();

            if (response.ok) {
                return { status: true, data };
            }

            logger.error('termii sms error', data);
            return { status: false, error: "sorry can't send message at the moment", message: data };
        } catch (error) {
            logger.error('termii sms error', { error });
            return { status: false, error: "sorry can't send message at the moment", message: error };
        }
    }

    private static formatPhoneNumber(phone: string) {
        if (phone.length === 11 && phone.startsWith('0')) {
            return '234' + phone.substring(1);
        }
        return phone;
    }

    public static getCountry(phone: string) {
        let formattedPhone = phone;
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = '+' + formattedPhone;
        }

        // Search through countries-list
        for (const code in countries) {
            const obj = (countries as any)[code];
            // obj.phone can be an array of numbers or strings containing dial codes (e.g. [234], [254])
            const dialCodes: string[] = Array.isArray(obj.phone)
                ? obj.phone.map(String)
                : String(obj.phone).split(',');

            for (const dialCode of dialCodes) {
                if (formattedPhone.startsWith('+' + dialCode.replace('+', '').trim())) {
                    if (obj.name === 'Kenya') {
                        return { from: 'secureOTP', channel: 'generic', country: obj.name };
                    } else if (['Uganda', 'Tanzania'].includes(obj.name)) {
                        return { from: 'SECUREOTP', channel: 'generic', country: obj.name };
                    } else if (obj.name !== 'Nigeria') {
                        return { from: 'trisonet', channel: 'generic', country: obj.name };
                    } else {
                        return { from: this.senderId, channel: 'dnd', country: 'Nigeria' };
                    }
                }
            }
        }

        // Default fallback
        return {
            from: this.senderId,
            channel: 'dnd',
            country: 'Nigeria'
        };
    }

}
