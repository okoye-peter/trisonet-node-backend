import { logger } from '../utils/logger.js';
import { countries } from 'countries-list';

export class TermiiService {
    private static apiKey = process.env.TERMII_API_KEY;
    private static emailConfigId = process.env.TERMII_EMAIL_CONFIG_ID;
    private static senderId = process.env.TERMII_SENDER_ID || 'N-Alert';

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

    public static async sendMailWithTermii(email: string, code: string) {
        try {
            const response = await fetch('https://api.ng.termii.com/api/email/otp/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    email_configuration_id: this.emailConfigId,
                    code: code,
                    email_address: email
                })
            });

            const data = await response.json();

            if (response.ok) {
                return { status: true, data };
            }

            logger.error('termii mail error', { data });
            return { status: false, error: "sorry can't mail at the moment", message: data };
        } catch (error) {
            logger.error('termii mail error', { error });
            return { status: false, error: "sorry can't mail at the moment", message: error };
        }
    }

    public static async sendTemplate(
        email: string,
        subject: string,
        variables: Record<string, string>
    ): Promise<boolean> {
        try {
            const response = await fetch('https://api.ng.termii.com/api/templates/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    email_configuration_id: 'f4f54611-4cd3-4490-96ab-f9a764f4f869',
                    template_id: '6bd1e7d7-9271-4edd-bcca-4849a6cd6858',
                    email,
                    subject,
                    variables,
                }),
            });

            const data = await response.json() as { code?: string };

            if (!response.ok) {
                logger.error('Termii sendTemplate error', {
                    email,
                    status: response.status,
                    response: data,
                });
            } else {
                logger.info('Termii sendTemplate success', {
                    email,
                    response: data,
                });
            }

            return response.ok && data.code === 'ok';
        } catch (error) {
            logger.error('Termii sendTemplate exception', { email, error });
            return false;
        }
    }
}
