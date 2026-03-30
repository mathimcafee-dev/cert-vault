// src/lib/plans.js
// After creating Stripe products, replace the price IDs below

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    certLimit: 25,
    userLimit: 1,
    emailAlerts: false,
    features: [
      '25 certificates',
      'Certificate Inventory',
      'DMARC & DNS Toolkit',
      'CSR Generator',
      'Certificate Labs',
    ],
    cta: 'Get started free',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 19,
    certLimit: 500,
    userLimit: 3,
    emailAlerts: true,
    stripePriceId: 'price_REPLACE_WITH_PRO_PRICE_ID',
    features: [
      '500 certificates',
      'Email alerts at 60/30/14/7 days',
      '3 team members',
      'All DMARC & DNS tools',
      'Priority support',
    ],
    cta: 'Start 14-day free trial',
    popular: true,
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    price: 49,
    certLimit: 999999,
    userLimit: 10,
    emailAlerts: true,
    stripePriceId: 'price_REPLACE_WITH_AGENCY_PRICE_ID',
    features: [
      'Unlimited certificates',
      'Email alerts + custom schedule',
      '10 team members',
      'White-label ready',
      'API access',
    ],
    cta: 'Start 14-day free trial',
  },
}
