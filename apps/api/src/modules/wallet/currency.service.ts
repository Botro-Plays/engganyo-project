import { Injectable, Logger } from '@nestjs/common';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=PHP,EUR,SGD,GBP';
const CACHE_TTL_MS    = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATES: Record<string, number> = {
  PHP: 56.5,
  EUR: 0.92,
  SGD: 1.35,
  GBP: 0.79,
};

interface FrankfurterResponse {
  base: string;
  rates: Record<string, number>;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private cachedRates: Record<string, number> = { ...FALLBACK_RATES };
  private fetchedAt: Date | null = null;

  async getRates(): Promise<Record<string, number>> {
    const now = new Date();
    if (this.fetchedAt && now.getTime() - this.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.cachedRates;
    }
    try {
      const res = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FrankfurterResponse;
      this.cachedRates = data.rates;
      this.fetchedAt = now;
      this.logger.log(`Exchange rates refreshed: ${JSON.stringify(data.rates)}`);
    } catch (err) {
      this.logger.warn(`Failed to fetch exchange rates (${String(err)}), using cached values`);
    }
    return this.cachedRates;
  }

  async getUsdToPhp(): Promise<number> {
    const rates = await this.getRates();
    return rates['PHP'] ?? FALLBACK_RATES['PHP'];
  }

  async getUsdToRate(currency: string): Promise<number> {
    const rates = await this.getRates();
    const upper = currency.toUpperCase();
    return rates[upper] ?? FALLBACK_RATES[upper] ?? 1;
  }
}
