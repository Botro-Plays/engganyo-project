import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../database/redis.service';

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

  constructor(private readonly redisService: RedisService) {}

  async getRates(): Promise<Record<string, number>> {
    const now = Date.now();
    const fetchedAtRaw = await this.redisService.get('currency:fetchedAt');
    const fetchedAt = fetchedAtRaw ? parseInt(fetchedAtRaw, 10) : 0;

    if (fetchedAt && now - fetchedAt < CACHE_TTL_MS) {
      const cached = await this.redisService.getJson<Record<string, number>>('currency:rates');
      if (cached) return cached;
    }

    let rates: Record<string, number> = { ...FALLBACK_RATES };
    try {
      const res = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FrankfurterResponse;
      rates = data.rates;
      await this.redisService.setJson('currency:rates', rates, 3600);
      await this.redisService.set('currency:fetchedAt', String(now), 3600);
      this.logger.log(`Exchange rates refreshed: ${JSON.stringify(data.rates)}`);
    } catch (err) {
      this.logger.warn(`Failed to fetch exchange rates (${String(err)}), using cached values`);
      // On fetch failure, try to return stale cached rates from Redis before falling back
      const stale = await this.redisService.getJson<Record<string, number>>('currency:rates');
      if (stale) return stale;
    }
    return rates;
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
