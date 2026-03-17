import { z } from "zod";

export const buyAirtimeSchema = z.object({
    body: z.object({
        amount: z.number({ error: 'amount is required' }).min(100, 'minimum amount is 100'),
        network: z.string({ error: 'network is required' }),
        airtime_phone_no: z.string({ error: 'phone number is required' }),
        airtime_wallet: z.union([z.string(), z.number()]),
        withdrawal_pin: z.string({ error: 'withdrawal pin is required' })
    })
});

export const buyDataSchema = z.object({
    body: z.object({
        data_bundle: z.string({ error: 'data bundle is required' }),
        data_network: z.string({ error: 'network is required' }),
        data_phone_no: z.string({ error: 'phone number is required' }),
        data_wallet: z.union([z.string(), z.number()]),
        data_amount: z.number({ error: 'amount is required' }),
        withdrawal_pin: z.string({ error: 'withdrawal pin is required' })
    })
});

export const subCableSchema = z.object({
    body: z.object({
        package: z.string({ error: 'package is required' }),
        cabletv: z.string({ error: 'cable provider is required' }),
        dish_number: z.string({ error: 'dish number is required' }),
        cable_amount: z.number({ error: 'amount is required' }),
        cable_wallet: z.union([z.string(), z.number()]),
        withdrawal_pin: z.string({ error: 'withdrawal pin is required' })
    })
});
