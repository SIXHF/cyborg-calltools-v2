const IPQS_API_KEY = process.env.IPQS_API_KEY ?? '';

export interface FraudCheckResult {
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
}

/**
 * Check phone number fraud score via IPQualityScore.
 */
export async function checkFraud(phoneNumber: string): Promise<FraudCheckResult> {
  if (!IPQS_API_KEY) {
    return { score: 0, riskLevel: 'low', flags: ['Fraud check not configured'] };
  }

  const normalized = phoneNumber.replace(/\D/g, '');

  try {
    const response = await fetch(
      `https://ipqualityscore.com/api/json/phone/${IPQS_API_KEY}/${encodeURIComponent(normalized)}?country[]=US`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      return { score: 0, riskLevel: 'low', flags: ['Check failed'] };
    }

    const data = await response.json() as {
      fraud_score: number;
      valid: boolean;
      active: boolean;
      risky: boolean;
      spammer: boolean;
      line_type?: string;
    };

    const flags: string[] = [];
    if (!data.valid) flags.push('Invalid number');
    if (!data.active) flags.push('Inactive');
    if (data.risky) flags.push('Risky');
    if (data.spammer) flags.push('Known spammer');
    if (data.line_type) flags.push(`Type: ${data.line_type}`);

    const riskLevel = data.fraud_score >= 75 ? 'high' : data.fraud_score >= 40 ? 'medium' : 'low';

    return { score: data.fraud_score, riskLevel, flags };
  } catch {
    return { score: 0, riskLevel: 'low', flags: ['Check timeout'] };
  }
}
