/**
 * Kite market-data adapter.
 *
 * The adapter is the only place Kite SDK shapes are allowed. Services consume
 * normalized structures, so these tests pin the translation for instruments,
 * quotes and both historical timeframes — including the exact SDK call shape
 * and the wire date formats ingestion depends on.
 */

const mockGetInstruments = jest.fn((...args: unknown[]): Promise<unknown[]> => {
  void args;
  return Promise.resolve([]);
});
const mockGetHistoricalData = jest.fn((...args: unknown[]): Promise<unknown[]> => {
  void args;
  return Promise.resolve([]);
});
const mockGetQuotes = jest.fn((...args: unknown[]): Promise<unknown> => {
  void args;
  return Promise.resolve(new Map());
});
const mockCreateKiteClient = jest.fn((...args: unknown[]) => {
  void args;
  return {
    getInstruments: mockGetInstruments,
    getHistoricalData: mockGetHistoricalData,
  };
});

jest.mock('@/lib/kite-client', () => ({
  createKiteClient: (...args: unknown[]) => mockCreateKiteClient(...args),
  getQuotes: (...args: unknown[]) => mockGetQuotes(...args),
}));

import { kiteMarketDataProvider } from '@/lib/market-data/kite-adapter';

const credentials = { accessToken: 'system-token', apiKey: 'system-app-key' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateKiteClient.mockReturnValue({
    getInstruments: mockGetInstruments,
    getHistoricalData: mockGetHistoricalData,
  });
});

describe('kiteMarketDataProvider.listInstruments', () => {
  test('normalizes the Kite master and drops rows without a usable token', async () => {
    mockGetInstruments.mockResolvedValue([
      {
        instrument_token: '408065',
        exchange: 'NSE',
        tradingsymbol: 'INFY',
        name: 'Infosys',
        instrument_type: 'EQ',
        segment: 'NSE',
      },
      {
        instrument_token: 'not-a-token',
        exchange: 'NSE',
        tradingsymbol: 'BAD',
        name: null,
        instrument_type: 'EQ',
        segment: 'NSE',
      },
    ]);

    const rows = await kiteMarketDataProvider.listInstruments(credentials, 'NSE');

    expect(mockCreateKiteClient).toHaveBeenCalledWith('system-token', 'system-app-key');
    expect(mockGetInstruments).toHaveBeenCalledWith('NSE');
    expect(rows).toEqual([
      {
        providerInstrumentKey: '408065',
        exchange: 'NSE',
        tradingSymbol: 'INFY',
        companyName: 'Infosys',
        instrumentType: 'EQ',
        segment: 'NSE',
      },
    ]);
  });
});

describe('kiteMarketDataProvider.getQuotes', () => {
  test('delegates to the batch quote service under the same application key', async () => {
    const quotes = new Map([['NSE:INFY', { lastPrice: 100 }]]);
    mockGetQuotes.mockResolvedValue(quotes);

    const result = await kiteMarketDataProvider.getQuotes(credentials, ['NSE:INFY']);

    expect(mockGetQuotes).toHaveBeenCalledWith('system-token', ['NSE:INFY'], 'system-app-key');
    expect(result).toBe(quotes);
  });
});

describe('kiteMarketDataProvider.getHistoricalCandles', () => {
  test('daily: uses the day interval and UTC session dates', async () => {
    mockGetHistoricalData.mockResolvedValue([
      { date: new Date('2024-01-02T00:00:00+05:30'), open: 100, high: 110, low: 95, close: 108, volume: 5000 },
    ]);

    const candles = await kiteMarketDataProvider.getHistoricalCandles(
      credentials,
      '408065',
      '1D',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-30T00:00:00Z')
    );

    expect(mockGetHistoricalData).toHaveBeenCalledWith(
      408065,
      'day',
      '2024-01-01 09:15:00',
      '2024-01-30 15:30:00'
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 95, close: 108, volume: 5000 });
    expect(candles[0].timestamp).toBeInstanceOf(Date);
  });

  test('hourly: uses the 60minute interval and IST wall-clock windows', async () => {
    mockGetHistoricalData.mockResolvedValue([]);

    await kiteMarketDataProvider.getHistoricalCandles(
      credentials,
      '408065',
      '1H',
      new Date('2024-05-10T03:45:00Z'),
      new Date('2024-05-10T10:00:00Z')
    );

    expect(mockGetHistoricalData).toHaveBeenCalledWith(
      408065,
      '60minute',
      '2024-05-10 09:15:00',
      '2024-05-10 15:30:00'
    );
  });

  test('rejects a non-numeric instrument key before calling the provider', async () => {
    await expect(
      kiteMarketDataProvider.getHistoricalCandles(
        credentials,
        'UPSTOX-KEY',
        '1D',
        new Date('2024-01-01'),
        new Date('2024-01-02')
      )
    ).rejects.toThrow(/not a numeric instrument token/);
    expect(mockGetHistoricalData).not.toHaveBeenCalled();
  });
});
