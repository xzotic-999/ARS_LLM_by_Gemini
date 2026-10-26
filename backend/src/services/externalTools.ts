export interface ExternalToolsRuntimeConfig {
  WEATHER_API_BASE_URL?: string;
  WEATHER_GEOCODING_BASE_URL?: string;
  OPEN_METEO_API_KEY?: string;
  EXCHANGE_RATE_API_BASE_URL?: string;
  EXCHANGE_RATE_FALLBACK_BASE_URL?: string;
  EXCHANGE_RATE_API_KEY?: string;
  EXTERNAL_TOOLS_TIMEOUT_MS?: number;
  EXTERNAL_TOOLS_CACHE_TTL_MS?: number;
}

export interface WeatherToolResult {
  tool: "weather";
  available: boolean;
  source: string;
  sourceUrl: string;
  location?: {
    query: string;
    name: string;
    country: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current?: {
    temperatureC: number;
    apparentTemperatureC: number;
    humidityPercent: number;
    windSpeedKmh: number;
    weatherCode: number;
    condition: string;
  };
  observedAt: string | null;
  fetchedAt: string;
  cached: boolean;
  staleFallback: boolean;
  error?: string;
}

export interface ExchangeRatesToolResult {
  tool: "exchange_rates";
  available: boolean;
  source: string;
  sourceUrl: string;
  baseCurrency: string;
  amount: number;
  targetCurrencies: string[];
  rates?: Record<string, number>;
  converted?: Record<string, number>;
  kztCrossRates?: Record<string, number>;
  updatedAt: string | null;
  fetchedAt: string;
  cached: boolean;
  staleFallback: boolean;
  error?: string;
}

export type ExternalToolExecutionResult = WeatherToolResult | ExchangeRatesToolResult;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const weatherCache = new Map<string, CacheEntry<WeatherToolResult>>();
const ratesCache = new Map<string, CacheEntry<ExchangeRatesToolResult>>();

export function clearExternalToolsCache(): void {
  weatherCache.clear();
  ratesCache.clear();
}

interface KnownCityCoord {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  aliases: RegExp[];
}

const KNOWN_CITIES: KnownCityCoord[] = [
  {
    name: "Алматы",
    country: "Казахстан",
    latitude: 43.2389,
    longitude: 76.8897,
    timezone: "Asia/Almaty",
    aliases: [/алмат[ыеуой]/i, /\balmaty\b/i, /алма-ат[аеыу]/i],
  },
  {
    name: "Астана",
    country: "Казахстан",
    latitude: 51.1694,
    longitude: 71.4491,
    timezone: "Asia/Almaty",
    aliases: [/астан[аеыуой]/i, /\bastana\b/i, /нур-султан[аеу]?/i],
  },
  {
    name: "Шымкент",
    country: "Казахстан",
    latitude: 42.3417,
    longitude: 69.5901,
    timezone: "Asia/Almaty",
    aliases: [/шымкент[аеу]?/i, /чимкент[аеу]?/i, /\bshymkent\b/i],
  },
  {
    name: "Караганда",
    country: "Казахстан",
    latitude: 49.8047,
    longitude: 73.1094,
    timezone: "Asia/Almaty",
    aliases: [/караганд[аеыуой]/i, /\bkaragand[ay]\b/i],
  },
  {
    name: "Актобе",
    country: "Казахстан",
    latitude: 50.2839,
    longitude: 57.167,
    timezone: "Asia/Aqtobe",
    aliases: [/актобе/i, /актюбинск[аеу]?/i, /\baktobe\b/i],
  },
  {
    name: "Атырау",
    country: "Казахстан",
    latitude: 47.0945,
    longitude: 51.9238,
    timezone: "Asia/Atyrau",
    aliases: [/атырау/i, /\batyrau\b/i],
  },
  {
    name: "Павлодар",
    country: "Казахстан",
    latitude: 52.2873,
    longitude: 76.9674,
    timezone: "Asia/Almaty",
    aliases: [/павлодар[аеу]?/i, /\bpavlodar\b/i],
  },
  {
    name: "Усть-Каменогорск",
    country: "Казахстан",
    latitude: 49.9483,
    longitude: 82.6278,
    timezone: "Asia/Almaty",
    aliases: [/усть-каменогорск[аеу]?/i, /оскемен[еау]?/i, /\boskemen\b/i],
  },
  {
    name: "Семей",
    country: "Казахстан",
    latitude: 50.4111,
    longitude: 80.2275,
    timezone: "Asia/Almaty",
    aliases: [/семе[йяею]/i, /семипалатинск[аеу]?/i, /\bsemey\b/i],
  },
  {
    name: "Костанай",
    country: "Казахстан",
    latitude: 53.2144,
    longitude: 63.6246,
    timezone: "Asia/Qostanay",
    aliases: [/костана[йяею]/i, /кустана[йяею]/i, /\bkostanay\b/i],
  },
  {
    name: "Актау",
    country: "Казахстан",
    latitude: 43.6532,
    longitude: 51.1975,
    timezone: "Asia/Aqtau",
    aliases: [/актау/i, /\baktau\b/i],
  },
  {
    name: "Тараз",
    country: "Казахстан",
    latitude: 42.9,
    longitude: 71.3667,
    timezone: "Asia/Almaty",
    aliases: [/тараз[аеу]?/i, /\btaraz\b/i],
  },
  {
    name: "Уральск",
    country: "Казахстан",
    latitude: 51.2333,
    longitude: 51.3667,
    timezone: "Asia/Oral",
    aliases: [/уральск[аеу]?/i, /орал[аеу]?/i, /\boral\b/i],
  },
  {
    name: "Петропавловск",
    country: "Казахстан",
    latitude: 54.8753,
    longitude: 69.1628,
    timezone: "Asia/Almaty",
    aliases: [/петропавловск[аеу]?/i, /\bpetropavl\b/i],
  },
  {
    name: "Кызылорда",
    country: "Казахстан",
    latitude: 44.8488,
    longitude: 65.4823,
    timezone: "Asia/Qyzylorda",
    aliases: [/кызылорд[аеыу]/i, /\bkyzylorda\b/i],
  },
  {
    name: "Москва",
    country: "Россия",
    latitude: 55.7558,
    longitude: 37.6173,
    timezone: "Europe/Moscow",
    aliases: [/москв[аеыуой]/i, /\bmoscow\b/i, /\bмск\b/i],
  },
  {
    name: "Санкт-Петербург",
    country: "Россия",
    latitude: 59.9343,
    longitude: 30.3351,
    timezone: "Europe/Moscow",
    aliases: [/санкт-петербург[аеу]?/i, /петербург[аеу]?/i, /питер[аеу]?/i, /\bsaint\s*petersburg\b/i, /\bспб\b/i],
  },
  {
    name: "Ташкент",
    country: "Узбекистан",
    latitude: 41.2995,
    longitude: 69.2401,
    timezone: "Asia/Tashkent",
    aliases: [/ташкент[аеу]?/i, /\btashkent\b/i],
  },
  {
    name: "Бишкек",
    country: "Кыргызстан",
    latitude: 42.8746,
    longitude: 74.5698,
    timezone: "Asia/Bishkek",
    aliases: [/бишкек[аеу]?/i, /\bbishkek\b/i],
  },
  {
    name: "Баку",
    country: "Азербайджан",
    latitude: 40.4093,
    longitude: 49.8671,
    timezone: "Asia/Baku",
    aliases: [/баку/i, /\bbaku\b/i],
  },
  {
    name: "Тбилиси",
    country: "Грузия",
    latitude: 41.7151,
    longitude: 44.8271,
    timezone: "Asia/Tbilisi",
    aliases: [/тбилиси/i, /\btbilisi\b/i],
  },
  {
    name: "Минск",
    country: "Беларусь",
    latitude: 53.9006,
    longitude: 27.559,
    timezone: "Europe/Minsk",
    aliases: [/минск[аеу]?/i, /\bminsk\b/i],
  },
  {
    name: "Лондон",
    country: "Великобритания",
    latitude: 51.5074,
    longitude: -0.1278,
    timezone: "Europe/London",
    aliases: [/лондон[аеу]?/i, /\blondon\b/i],
  },
  {
    name: "Берлин",
    country: "Германия",
    latitude: 52.52,
    longitude: 13.405,
    timezone: "Europe/Berlin",
    aliases: [/берлин[аеу]?/i, /\bberlin\b/i],
  },
  {
    name: "Париж",
    country: "Франция",
    latitude: 48.8566,
    longitude: 2.3522,
    timezone: "Europe/Paris",
    aliases: [/париж[аеу]?/i, /\bparis\b/i],
  },
  {
    name: "Нью-Йорк",
    country: "США",
    latitude: 40.7128,
    longitude: -74.006,
    timezone: "America/New_York",
    aliases: [/нью-йорк[аеу]?/i, /\bnew\s*york\b/i],
  },
  {
    name: "Токио",
    country: "Япония",
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: "Asia/Tokyo",
    aliases: [/токио/i, /\btokyo\b/i],
  },
  {
    name: "Дубай",
    country: "ОАЭ",
    latitude: 25.2048,
    longitude: 55.2708,
    timezone: "Asia/Dubai",
    aliases: [/дуба[йеию]/i, /\bdubai\b/i],
  },
  {
    name: "Стамбул",
    country: "Турция",
    latitude: 41.0082,
    longitude: 28.9784,
    timezone: "Europe/Istanbul",
    aliases: [/стамбул[аеу]?/i, /\bistanbul\b/i],
  },
  {
    name: "Пекин",
    country: "Китай",
    latitude: 39.9042,
    longitude: 116.4074,
    timezone: "Asia/Shanghai",
    aliases: [/пекин[аеу]?/i, /\bbeijing\b/i],
  },
];

const WMO_WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Ясно",
  1: "Преимущественно ясно",
  2: "Переменная облачность",
  3: "Пасмурно",
  45: "Туман",
  48: "Изморозь / туман",
  51: "Лёгкая морось",
  53: "Умеренная морось",
  55: "Сильная морось",
  56: "Ледяная морось",
  57: "Сильная ледяная морось",
  61: "Небольшой дождь",
  63: "Умеренный дождь",
  65: "Сильный дождь",
  66: "Ледяной дождь",
  67: "Сильный ледяной дождь",
  71: "Небольшой снег",
  73: "Умеренный снег",
  75: "Сильный снегопад",
  77: "Снежные зёрна",
  80: "Ливневый дождь",
  81: "Умеренный ливень",
  82: "Сильный ливень",
  85: "Небольшой снежный заряд",
  86: "Сильный снежный заряд",
  95: "Гроза",
  96: "Гроза с небольшим градом",
  99: "Гроза с сильным градом",
};

export function describeWmoWeatherCode(code: number): string {
  return WMO_WEATHER_CODE_DESCRIPTIONS[code] ?? `Код погоды WMO ${code}`;
}

export function resolveKnownCityFromText(text: string): KnownCityCoord | null {
  for (const city of KNOWN_CITIES) {
    if (city.aliases.some((re) => re.test(text))) {
      return city;
    }
  }
  return null;
}

function extractCityCandidateFromText(text: string): string {
  const known = resolveKnownCityFromText(text);
  if (known) return known.name;

  // Try matching "погода в городе <City>" or "погода в <City>" or "weather in <City>"
  const prepMatch =
    /(?:погод[ауые]|температур[ауые]|прогноз\s+погоды|weather|temperature)\s+(?:сейчас\s+)?(?:в\s+городе|в|во|для|по|in|for)\s+([А-Яа-яЁёA-Za-z\-]{3,35})/i.exec(
      text
    );
  if (prepMatch && prepMatch[1]) {
    return prepMatch[1].trim();
  }

  return "Алматы";
}

/**
 * Fetches live weather data from Open-Meteo API (`https://api.open-meteo.com/v1/forecast`)
 * with timeout, TTL cache, stale-cache fallback, and explicit error reporting.
 */
export async function fetchWeatherData(
  cityOrPrompt: string,
  config: ExternalToolsRuntimeConfig = {},
  fetchFn: typeof fetch = fetch
): Promise<WeatherToolResult> {
  const weatherBaseUrl = (
    config.WEATHER_API_BASE_URL ||
    process.env.WEATHER_API_BASE_URL ||
    "https://api.open-meteo.com/v1"
  ).replace(/\/+$/, "");

  const geocodingBaseUrl = (
    config.WEATHER_GEOCODING_BASE_URL ||
    process.env.WEATHER_GEOCODING_BASE_URL ||
    "https://geocoding-api.open-meteo.com/v1"
  ).replace(/\/+$/, "");

  const timeoutMs =
    config.EXTERNAL_TOOLS_TIMEOUT_MS ??
    Number(process.env.EXTERNAL_TOOLS_TIMEOUT_MS || 6_000);
  const cacheTtlMs =
    config.EXTERNAL_TOOLS_CACHE_TTL_MS ??
    Number(process.env.EXTERNAL_TOOLS_CACHE_TTL_MS || 600_000);

  const knownCity = resolveKnownCityFromText(cityOrPrompt);
  const rawCityQuery = knownCity ? knownCity.name : extractCityCandidateFromText(cityOrPrompt);
  const cacheKey = rawCityQuery.toLowerCase();
  const nowMs = Date.now();
  const fetchedAt = new Date(nowMs).toISOString();

  const existingCache = weatherCache.get(cacheKey);
  if (existingCache && existingCache.expiresAt > nowMs) {
    return {
      ...existingCache.value,
      cached: true,
      staleFallback: false,
    };
  }

  try {
    let resolvedLocation = knownCity
      ? {
          query: rawCityQuery,
          name: knownCity.name,
          country: knownCity.country,
          latitude: knownCity.latitude,
          longitude: knownCity.longitude,
          timezone: knownCity.timezone,
        }
      : null;

    if (!resolvedLocation) {
      const geoUrl = `${geocodingBaseUrl}/search?name=${encodeURIComponent(
        rawCityQuery
      )}&count=1&language=ru&format=json`;
      const geoRes = await fetchFn(geoUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!geoRes.ok) {
        throw new Error(`Open-Meteo Geocoding HTTP ${geoRes.status}`);
      }

      const geoData = (await geoRes.json()) as {
        results?: Array<{
          name?: string;
          country?: string;
          latitude?: number;
          longitude?: number;
          timezone?: string;
        }>;
      };

      const first = geoData.results?.[0];
      if (
        !first ||
        typeof first.latitude !== "number" ||
        typeof first.longitude !== "number"
      ) {
        return {
          tool: "weather",
          available: false,
          source: "Open-Meteo API (api.open-meteo.com)",
          sourceUrl: `${weatherBaseUrl}/forecast`,
          observedAt: null,
          fetchedAt,
          cached: false,
          staleFallback: false,
          error: `Населённый пункт "${rawCityQuery}" не найден в геокодере Open-Meteo.`,
        };
      }

      resolvedLocation = {
        query: rawCityQuery,
        name: first.name || rawCityQuery,
        country: first.country || "",
        latitude: first.latitude,
        longitude: first.longitude,
        timezone: first.timezone || "auto",
      };
    }

    const apiKeyParam =
      config.OPEN_METEO_API_KEY || process.env.OPEN_METEO_API_KEY
        ? `&apikey=${encodeURIComponent(
            (config.OPEN_METEO_API_KEY || process.env.OPEN_METEO_API_KEY || "").trim()
          )}`
        : "";

    const forecastUrl = `${weatherBaseUrl}/forecast?latitude=${resolvedLocation.latitude}&longitude=${resolvedLocation.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto${apiKeyParam}`;

    const weatherRes = await fetchFn(forecastUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!weatherRes.ok) {
      throw new Error(`Open-Meteo Forecast HTTP ${weatherRes.status}`);
    }

    const weatherData = (await weatherRes.json()) as {
      timezone?: string;
      current?: {
        time?: string;
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
    };

    const current = weatherData?.current;
    if (!current || typeof current.temperature_2m !== "number") {
      throw new Error("Open-Meteo returned incomplete current weather JSON");
    }

    const weatherCode = typeof current.weather_code === "number" ? current.weather_code : 0;

    const result: WeatherToolResult = {
      tool: "weather",
      available: true,
      source: "Open-Meteo API (api.open-meteo.com)",
      sourceUrl: "https://api.open-meteo.com/v1/forecast",
      location: {
        ...resolvedLocation,
        timezone: weatherData.timezone || resolvedLocation.timezone,
      },
      current: {
        temperatureC: current.temperature_2m,
        apparentTemperatureC:
          typeof current.apparent_temperature === "number"
            ? current.apparent_temperature
            : current.temperature_2m,
        humidityPercent:
          typeof current.relative_humidity_2m === "number"
            ? current.relative_humidity_2m
            : 0,
        windSpeedKmh:
          typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : 0,
        weatherCode,
        condition: describeWmoWeatherCode(weatherCode),
      },
      observedAt: current.time || fetchedAt,
      fetchedAt,
      cached: false,
      staleFallback: false,
    };

    weatherCache.set(cacheKey, {
      value: result,
      expiresAt: nowMs + cacheTtlMs,
    });

    return result;
  } catch (err) {
    if (existingCache) {
      return {
        ...existingCache.value,
        cached: true,
        staleFallback: true,
        error:
          err instanceof Error
            ? `Использован кэшированный снимок из-за сбоя сети: ${err.message}`
            : "Использован кэшированный снимок.",
      };
    }

    return {
      tool: "weather",
      available: false,
      source: "Open-Meteo API (api.open-meteo.com)",
      sourceUrl: `${weatherBaseUrl}/forecast`,
      observedAt: null,
      fetchedAt,
      cached: false,
      staleFallback: false,
      error:
        err instanceof Error
          ? `Не удалось получить данные о погоде от Open-Meteo API: ${err.message}`
          : "Сервис погоды Open-Meteo временно недоступен.",
    };
  }
}

const CURRENCY_ALIASES: Array<{ code: string; pattern: RegExp }> = [
  { code: "USD", pattern: /(?:доллар[а-я]*|usd|\$|бакс[а-я]*)/i },
  { code: "EUR", pattern: /(?:евро|eur|€)/i },
  { code: "KZT", pattern: /(?:тенге|kzt|₸|тг\b)/i },
  { code: "RUB", pattern: /(?:рубл[а-я]*|rub|₽)/i },
  { code: "CNY", pattern: /(?:юан[а-я]*|cny|rmb|¥)/i },
  { code: "GBP", pattern: /(?:фунт[а-я]*\s*стерлинг[а-я]*|фунт[а-я]*|gbp|£)/i },
  { code: "AED", pattern: /(?:дирхам[а-я]*|aed)/i },
  { code: "TRY", pattern: /(?:лир[а-я]*|try\b)/i },
  { code: "UZS", pattern: /(?:сум[а-я]*|uzs)/i },
  { code: "KGS", pattern: /(?:сом[а-я]*|kgs)/i },
  { code: "CHF", pattern: /(?:франк[а-я]*|chf)/i },
  { code: "JPY", pattern: /(?:иен[а-я]*|йен[а-я]*|jpy)/i },
];

export function parseCurrencyQueryFromText(text: string): {
  baseCurrency: string;
  targetCurrencies: string[];
  amount: number;
} {
  const detectedCodes: string[] = [];
  for (const item of CURRENCY_ALIASES) {
    if (item.pattern.test(text)) {
      detectedCodes.push(item.code);
    }
  }

  // Extract explicit numeric amount if present, e.g. "250 долларов в тенге" or "1000 EUR"
  let amount = 1;
  const amountMatch =
    /(\d+(?:[.,]\d+)?)\s*(?:тысяч[аи]?|тыс\.?)?\s*(?:доллар|евро|рубл|тенге|юан|фунт|дирхам|usd|eur|kzt|rub|cny|gbp|aed|try)/i.exec(
      text
    );
  if (amountMatch && amountMatch[1]) {
    const parsedNum = parseFloat(amountMatch[1].replace(",", "."));
    if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum <= 1_000_000_000) {
      amount = /тысяч|тыс/i.test(amountMatch[0]) ? parsedNum * 1000 : parsedNum;
    }
  }

  const baseCurrency = detectedCodes[0] || "USD";
  const defaultTargets = ["KZT", "USD", "EUR", "RUB", "CNY", "GBP"];
  const targetCurrencies = Array.from(
    new Set([...detectedCodes.slice(1), ...defaultTargets])
  ).filter((c) => c !== baseCurrency);

  return {
    baseCurrency,
    targetCurrencies,
    amount,
  };
}

/**
 * Fetches official reference exchange rates from ExchangeRate-API (`https://open.er-api.com/v6/latest/{BASE}`)
 * with automatic failover to Frankfurter ECB API (`https://api.frankfurter.dev/v1/latest`),
 * timeout, TTL cache, stale-cache fallback, and cross-rates to KZT.
 */
export async function fetchExchangeRatesData(
  params: {
    baseCurrency?: string;
    targetCurrencies?: string[];
    amount?: number;
    rawPrompt?: string;
  },
  config: ExternalToolsRuntimeConfig = {},
  fetchFn: typeof fetch = fetch
): Promise<ExchangeRatesToolResult> {
  const parsedFromPrompt = params.rawPrompt
    ? parseCurrencyQueryFromText(params.rawPrompt)
    : null;

  const baseCurrency = (
    params.baseCurrency ||
    parsedFromPrompt?.baseCurrency ||
    "USD"
  )
    .trim()
    .toUpperCase();

  const targetCurrencies = (
    params.targetCurrencies && params.targetCurrencies.length > 0
      ? params.targetCurrencies
      : parsedFromPrompt?.targetCurrencies || ["KZT", "EUR", "RUB", "CNY", "GBP"]
  ).map((c) => c.trim().toUpperCase());

  const amount =
    typeof params.amount === "number" && params.amount > 0
      ? params.amount
      : parsedFromPrompt?.amount || 1;

  const primaryBaseUrl = (
    config.EXCHANGE_RATE_API_BASE_URL ||
    process.env.EXCHANGE_RATE_API_BASE_URL ||
    "https://open.er-api.com/v6/latest"
  ).replace(/\/+$/, "");

  const fallbackBaseUrl = (
    config.EXCHANGE_RATE_FALLBACK_BASE_URL ||
    process.env.EXCHANGE_RATE_FALLBACK_BASE_URL ||
    "https://api.frankfurter.dev/v1/latest"
  ).replace(/\/+$/, "");

  const timeoutMs =
    config.EXTERNAL_TOOLS_TIMEOUT_MS ??
    Number(process.env.EXTERNAL_TOOLS_TIMEOUT_MS || 6_000);
  const cacheTtlMs =
    config.EXTERNAL_TOOLS_CACHE_TTL_MS ??
    Number(process.env.EXTERNAL_TOOLS_CACHE_TTL_MS || 1_800_000);

  const cacheKey = baseCurrency;
  const nowMs = Date.now();
  const fetchedAt = new Date(nowMs).toISOString();

  const buildFilteredResult = (
    cachedBase: ExchangeRatesToolResult,
    isCached: boolean,
    isStaleFallback: boolean,
    errNote?: string
  ): ExchangeRatesToolResult => {
    const allRates = cachedBase.rates || {};
    const filteredRates: Record<string, number> = {};
    const converted: Record<string, number> = {};
    for (const code of targetCurrencies) {
      if (typeof allRates[code] === "number") {
        filteredRates[code] = Number(allRates[code].toFixed(6));
        converted[code] = Number((allRates[code] * amount).toFixed(2));
      }
    }

    // Calculate convenient 1 UNIT -> KZT cross-rates when KZT is present
    const kztCrossRates: Record<string, number> = {};
    const baseToKzt =
      baseCurrency === "KZT" ? 1 : typeof allRates.KZT === "number" ? allRates.KZT : null;
    if (baseToKzt !== null) {
      if (baseCurrency !== "KZT") {
        kztCrossRates[`1 ${baseCurrency} в KZT`] = Number(baseToKzt.toFixed(2));
      }
      for (const foreign of ["USD", "EUR", "RUB", "CNY", "GBP"]) {
        if (foreign === baseCurrency || foreign === "KZT") continue;
        const rateInBase = allRates[foreign];
        if (typeof rateInBase === "number" && rateInBase > 0) {
          kztCrossRates[`1 ${foreign} в KZT`] = Number((baseToKzt / rateInBase).toFixed(2));
        }
      }
    }

    return {
      ...cachedBase,
      amount,
      targetCurrencies,
      rates: Object.keys(filteredRates).length > 0 ? filteredRates : allRates,
      converted: Object.keys(converted).length > 0 ? converted : undefined,
      kztCrossRates: Object.keys(kztCrossRates).length > 0 ? kztCrossRates : undefined,
      cached: isCached,
      staleFallback: isStaleFallback,
      error: errNote ?? cachedBase.error,
    };
  };

  const existingCache = ratesCache.get(cacheKey);
  if (existingCache && existingCache.expiresAt > nowMs) {
    return buildFilteredResult(existingCache.value, true, false);
  }

  // 1. Primary Provider: Open Exchange Rates (open.er-api.com/v6/latest/{BASE})
  try {
    const primaryUrl = `${primaryBaseUrl}/${encodeURIComponent(baseCurrency)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = (
      config.EXCHANGE_RATE_API_KEY ||
      process.env.EXCHANGE_RATE_API_KEY ||
      ""
    ).trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetchFn(primaryUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`ExchangeRate-API HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      result?: string;
      base_code?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };

    if (!data?.rates || typeof data.rates !== "object") {
      throw new Error("ExchangeRate-API returned empty rates table");
    }

    const fullEntry: ExchangeRatesToolResult = {
      tool: "exchange_rates",
      available: true,
      source: "ExchangeRate-API (open.er-api.com)",
      sourceUrl: primaryUrl,
      baseCurrency: data.base_code || baseCurrency,
      amount: 1,
      targetCurrencies,
      rates: data.rates,
      updatedAt: data.time_last_update_utc || fetchedAt,
      fetchedAt,
      cached: false,
      staleFallback: false,
    };

    ratesCache.set(cacheKey, {
      value: fullEntry,
      expiresAt: nowMs + cacheTtlMs,
    });

    return buildFilteredResult(fullEntry, false, false);
  } catch (primaryErr) {
    // 2. Secondary Failover Provider: Frankfurter ECB API
    try {
      const fallbackUrl = `${fallbackBaseUrl}?base=${encodeURIComponent(baseCurrency)}`;
      const fbRes = await fetchFn(fallbackUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!fbRes.ok) {
        throw new Error(`Frankfurter API HTTP ${fbRes.status}`);
      }

      const fbData = (await fbRes.json()) as {
        base?: string;
        date?: string;
        rates?: Record<string, number>;
      };

      if (!fbData?.rates || typeof fbData.rates !== "object") {
        throw new Error("Frankfurter API returned empty rates");
      }

      const fullEntry: ExchangeRatesToolResult = {
        tool: "exchange_rates",
        available: true,
        source: "Frankfurter ECB Reference API (api.frankfurter.dev)",
        sourceUrl: fallbackUrl,
        baseCurrency: fbData.base || baseCurrency,
        amount: 1,
        targetCurrencies,
        rates: fbData.rates,
        updatedAt: fbData.date || fetchedAt,
        fetchedAt,
        cached: false,
        staleFallback: false,
      };

      ratesCache.set(cacheKey, {
        value: fullEntry,
        expiresAt: nowMs + cacheTtlMs,
      });

      return buildFilteredResult(fullEntry, false, false);
    } catch {
      if (existingCache) {
        return buildFilteredResult(
          existingCache.value,
          true,
          true,
          primaryErr instanceof Error
            ? `Использован кэшированный курс из-за временной ошибки сети: ${primaryErr.message}`
            : "Использован кэшированный курс валют."
        );
      }

      return {
        tool: "exchange_rates",
        available: false,
        source: "ExchangeRate-API (open.er-api.com)",
        sourceUrl: `${primaryBaseUrl}/${baseCurrency}`,
        baseCurrency,
        amount,
        targetCurrencies,
        updatedAt: null,
        fetchedAt,
        cached: false,
        staleFallback: false,
        error:
          primaryErr instanceof Error
            ? `Сервис курсов валют временно недоступен: ${primaryErr.message}`
            : "Сервис курсов валют временно недоступен.",
      };
    }
  }
}

export interface DetectedToolIntents {
  needsWeather: boolean;
  needsExchangeRates: boolean;
}

const WEATHER_INTENT_REGEX =
  /(?:какая\s+погод|погод[ауые]\s+(?:в|во|на|сегодня|сейчас|завтра)|прогноз\s+погоды|температур[ауые]\s+(?:воздуха|в|на\s+улице|сейчас)|сколько\s+градусов|weather\s+(?:in|forecast|today)|current\s+weather)/i;

const EXCHANGE_RATES_INTENT_REGEX =
  /(?:курс[а-я]*\s+(?:валют|доллар|евро|рубл|тенге|юан|фунт|лир|дирхам|usd|eur|kzt|rub|cny|gbp)|обменн[а-я]+\s+курс|сколько\s+(?:стоит|будет|в\s+тенге|в\s+долларах|в\s+евро|в\s+рублях)|конвертир[а-я]+\s+(?:валют|доллар|евро|тенге|рубл)|(?:\d+\s*(?:usd|eur|kzt|rub|cny|gbp|доллар[а-я]*|евро|рубл[а-я]*|тенге)\s+(?:в|to|in)\s+(?:usd|eur|kzt|rub|cny|gbp|тенге|доллар[а-я]*|евро|рубл[а-я]*))|exchange\s+rate)/i;

/**
 * Strips `<untrusted_file_content>` blocks before checking tool intent so text inside attached files
 * does not accidentally trigger external weather/currency API calls.
 */
function stripUntrustedBlocks(text: string): string {
  return text
    .replace(/<untrusted_file_content\b[^>]*>[\s\S]*?<\/untrusted_file_content>/gi, " ")
    .replace(/---\s*Содержимое файла[\s\S]*?---\s*Конец файла[^\n]*---/g, " ")
    .trim();
}

export function detectExternalToolIntent(userPrompt: string): DetectedToolIntents {
  const cleanPrompt = stripUntrustedBlocks(userPrompt || "");
  if (!cleanPrompt) {
    return { needsWeather: false, needsExchangeRates: false };
  }
  return {
    needsWeather: WEATHER_INTENT_REGEX.test(cleanPrompt),
    needsExchangeRates: EXCHANGE_RATES_INTENT_REGEX.test(cleanPrompt),
  };
}

/**
 * Formats tool execution results into a structured `<verified_external_tool_data>` block
 * and provides a deterministic fallback response when an API is unreachable so the model
 * never hallucinates numbers.
 */
export function buildToolGroundingBlock(results: ExternalToolExecutionResult[]): {
  contextBlock: string;
  allRequestedToolsFailed: boolean;
  deterministicErrorReply: string | null;
} {
  if (results.length === 0) {
    return {
      contextBlock: "",
      allRequestedToolsFailed: false,
      deterministicErrorReply: null,
    };
  }

  const failedTools = results.filter((r) => !r.available);
  const allRequestedToolsFailed = failedTools.length === results.length;

  let deterministicErrorReply: string | null = null;
  if (allRequestedToolsFailed) {
    const lines = results.map((r) => {
      if (r.tool === "weather") {
        return `• **Погода (${r.source})**: сервис временно недоступен (${r.error || "ошибка соединения"}). Точные метеоданные на момент запроса (${r.fetchedAt}) не получены — в соответствии с регламентом ARS LLM я не привожу приблизительные или вымышленные значения температуры.`;
      }
      return `• **Курсы валют (${r.source})**: сервис временно недоступен (${r.error || "ошибка соединения"}). Актуальные котировки для базовой валюты **${r.baseCurrency}** на момент запроса (${r.fetchedAt}) не получены — в соответствии с регламентом ARS LLM я не выдумываю значения обменного курса.`;
    });
    deterministicErrorReply = `Внешний источник данных временно недоступен:\n\n${lines.join(
      "\n\n"
    )}\n\nПожалуйста, повторите запрос через несколько минут.`;
  }

  const instructions = [
    "[ДАННЫЕ ВНЕШНИХ ИНСТРУМЕНТОВ ARS LLM — ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ОТВЕТА]:",
    "1. Опирайся СТРОГО на приведённый ниже JSON в теге <verified_external_tool_data>.",
    "2. Обязательно укажи в ответе точный источник данных (`source`) и время актуальности/наблюдения (`observedAt` или `updatedAt`, а также `fetchedAt`).",
    "3. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать цифры, курсы валют или показатели погоды, которых нет в JSON. Если `available: false`, честно сообщи пользователю о недоступности внешнего сервиса и не приводи цифр по памяти.",
  ].join("\n");

  const contextBlock = `<verified_external_tool_data>\n${instructions}\n\n${JSON.stringify(
    results,
    null,
    2
  )}\n</verified_external_tool_data>`;

  return {
    contextBlock,
    allRequestedToolsFailed,
    deterministicErrorReply,
  };
}

/**
 * Inspects the latest user message in a conversation, executes any matching external tools
 * (weather and/or exchange rates) via backend with timeout & cache, and returns the enriched messages.
 */
export async function resolveAndEnrichMessagesWithExternalTools<
  T extends { role: "system" | "user" | "assistant"; content: string }
>(
  messages: T[],
  config: ExternalToolsRuntimeConfig = {},
  fetchFn: typeof fetch = fetch
): Promise<{
  messages: T[];
  toolResults: ExternalToolExecutionResult[];
  allRequestedToolsFailed: boolean;
  deterministicErrorReply: string | null;
}> {
  if (messages.length === 0) {
    return {
      messages,
      toolResults: [],
      allRequestedToolsFailed: false,
      deterministicErrorReply: null,
    };
  }

  const lastIdx = messages.length - 1;
  const lastMsg = messages[lastIdx];
  if (lastMsg.role !== "user") {
    return {
      messages,
      toolResults: [],
      allRequestedToolsFailed: false,
      deterministicErrorReply: null,
    };
  }

  const cleanUserPrompt = stripUntrustedBlocks(lastMsg.content);
  const intent = detectExternalToolIntent(cleanUserPrompt);
  if (!intent.needsWeather && !intent.needsExchangeRates) {
    return {
      messages,
      toolResults: [],
      allRequestedToolsFailed: false,
      deterministicErrorReply: null,
    };
  }

  const tasks: Promise<ExternalToolExecutionResult>[] = [];
  if (intent.needsWeather) {
    tasks.push(fetchWeatherData(cleanUserPrompt, config, fetchFn));
  }
  if (intent.needsExchangeRates) {
    tasks.push(
      fetchExchangeRatesData({ rawPrompt: cleanUserPrompt }, config, fetchFn)
    );
  }

  const toolResults = await Promise.all(tasks);
  const { contextBlock, allRequestedToolsFailed, deterministicErrorReply } =
    buildToolGroundingBlock(toolResults);

  const enrichedMessages = messages.map((msg, idx) => {
    if (idx !== lastIdx) return msg;
    return {
      ...msg,
      content: `${msg.content}\n\n${contextBlock}`,
    };
  });

  return {
    messages: enrichedMessages,
    toolResults,
    allRequestedToolsFailed,
    deterministicErrorReply,
  };
}
