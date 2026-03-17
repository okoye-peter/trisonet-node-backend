import axios from "axios";
import { getOrSetCache } from "../utils/cache";

export class VtuService {
    private baseUrl: string;
    private apiKey: string;
    private token: string | null = null;

    constructor() {
        this.baseUrl = process.env.VTU_BASE_URL || '';
        this.apiKey = process.env.VTU_API_KEY || '';
        
        if (!this.baseUrl) {
            console.warn('VTU_BASE_URL is not defined in environment variables');
        }
    }

    async callApi<T>(endpoint: string, data: any, method: 'POST' | 'GET' = 'POST'): Promise<T> {
        if (!this.token) {
            await this.generateToken();
        }

        try {

            const response = await axios({
                method: method.toUpperCase(),
                url: `${this.baseUrl}/${endpoint}`,
                data: method === 'POST' ? data : undefined,
                params: method === 'GET' ? data : undefined,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });
            return response.data;
        } catch (error: any) {
            console.error(`VTU API Error (${endpoint}):`, error?.response?.data || error.message);
            throw error;
        }
    }

    async generateToken(): Promise<void> {
        const username = process.env.VTU_USERNAME;
        const password = process.env.VTU_PASSWORD;

        if (!username || !password) {
            throw new Error('VTU credentials (USERNAME/PASSWORD) are missing');
        }

        try {
            const response = await axios.post(`${this.baseUrl}/jwt-auth/v1/token`, {
                username,
                password,
            });
                
            this.token = response.data.token;
        } catch (error: any) {
            console.error('Error generating VTU token:', error?.response?.data || error.message);
            throw new Error('Failed to authenticate with VTU service');
        }
    }

    private emptyDataResponse() {
        return {
            data_bundles: {},
            networks: [],
            status: false
        };
    }

    private emptyCableResponse() {
        return {
            packages: {},
            providers: [],
            status: false
        };
    }

    /**
     * Get all available data bundles grouped by service_id.
     */
    async getVtuDataBundles() {
        return getOrSetCache('vtu_data_bundles', 21600, async () => {
            try {
                const data: any = await this.callApi('api/v2/variations/data', {}, 'GET');
                
                if (data?.code !== 'success') {
                    return this.emptyDataResponse();
                }

                const data_bundles = data.data.reduce((acc: any, offer: any) => {
                    if (offer.availability?.toLowerCase() === 'available') {
                        const serviceId = offer.service_id;
                        if (!acc[serviceId]) acc[serviceId] = [];
                        acc[serviceId].push(offer);
                    }
                    return acc;
                }, {});

                return {
                    data_bundles,
                    networks: Object.keys(data_bundles),
                    status: true
                };
            } catch (error) {
                console.error('Error getting data bundles:', error);
                return this.emptyDataResponse();
            }
        });
    }

    /**
     * Purchase VTU data bundle.
     */
    async purchaseVtuDataBundle(service_id: string, variation_id: string, phone_number: string, request_id: string) {
        try {
            const data: any = await this.callApi('api/v2/data', {
                request_id,
                phone: phone_number,
                service_id,
                variation_id,
            });

            if (data?.code !== 'success') {
                return { status: false, error: 'VTU not available at the moment' };
            }

            return { status: true };
        } catch (error) {
            return { status: false, error: 'VTU not available at the moment' };
        }
    }

    /**
     * Get available cable offers.
     */
    async getVtuCableOffers() {
        return getOrSetCache('vtu_cable_offers', 21600, async () => {
            try {
                const data: any = await this.callApi('api/v2/variations/tv', {}, 'GET');
                
                if (data?.code !== 'success') {
                    return this.emptyCableResponse();
                }

                const packages = data.data.reduce((acc: any, offer: any) => {
                    if (offer.availability?.toLowerCase() === 'available') {
                        const serviceId = offer.service_id;
                        if (!acc[serviceId]) acc[serviceId] = [];
                        acc[serviceId].push(offer);
                    }
                    return acc;
                }, {});

                return {
                    packages,
                    providers: Object.keys(packages),
                    status: true
                };
            } catch (error) {
                return this.emptyCableResponse();
            }
        });
    }

    /**
     * Verify Cable number
     */
    async verifyCableNumber(customer_id: string, service_id: string): Promise<boolean> {
        try {
            const data: any = await this.callApi('api/v2/verify-customer', {
                customer_id,
                service_id,
            });

            return data?.code === 'success';
        } catch (error) {
            return false;
        }
    }

    /**
     * Purchase cable subscription.
     */
    async purchaseCableSubscription(service_id: string, variation_id: string, customer_id: string, amount: number, request_id: string) {
        const isVerified = await this.verifyCableNumber(customer_id, service_id);
        if (!isVerified) {
            return { status: false, message: 'invalid cable number' };
        }

        try {
            const data: any = await this.callApi('api/v2/tv', {
                request_id,
                customer_id,
                service_id,
                variation_id,
                subscription_type: 'change',
                amount,
            });

            if (data?.code !== 'success') {
                return { status: false, error: 'Cable service not available at the moment' };
            }

            return { status: true };
        } catch (error) {
            return { status: false, error: 'Cable service not available at the moment' };
        }
    }

    /**
     * Purchase airtime
     */
    async purchaseVtuAirtime(service_id: string, amount: number, phone_number: string, request_id: string) {
        try {
            const data: any = await this.callApi('api/v2/airtime', {
                request_id,
                phone: phone_number,
                service_id,
                amount: Math.floor(amount),
            });

            if (data?.code !== 'success') {
                return { status: false, error: 'Airtime vtu service currently not available' };
            }

            return { status: true };
        } catch (error) {
            return { status: false, error: 'Airtime vtu service currently not available' };
        }
    }

    /**
     * Get wallet balance
     */
    async getWalletBalance() {
        try {
            const data: any = await this.callApi('api/v2/balance', {}, 'GET');
            
            if (data?.code !== 'success') {
                return 'VTU unavailable';
            }
            
            return data.data.balance;
        } catch (error) {
            return 'VTU unavailable';
        }
    }
}