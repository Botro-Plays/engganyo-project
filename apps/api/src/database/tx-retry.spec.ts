import { withTransactionRetry, isRetryableTxError } from './tx-retry';

const pgError = (code: string, message = '') =>
  Object.assign(new Error(message || `pg ${code}`), { meta: { code } });

describe('isRetryableTxError', () => {
  it('retries deadlock, serialization, and Prisma write-conflict', () => {
    expect(isRetryableTxError(pgError('40P01'))).toBe(true);
    expect(isRetryableTxError(pgError('40001'))).toBe(true);
    expect(isRetryableTxError(Object.assign(new Error('x'), { code: 'P2034' }))).toBe(true);
    expect(isRetryableTxError(new Error('deadlock detected'))).toBe(true);
  });

  it('does not retry business or other errors', () => {
    expect(isRetryableTxError(new Error('Insufficient balance'))).toBe(false);
    expect(isRetryableTxError(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(false);
    expect(isRetryableTxError(pgError('23505'))).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });
});

describe('withTransactionRetry', () => {
  const client = (impl: jest.Mock) => ({ $transaction: impl });

  it('returns the transaction result on first success', async () => {
    const tx = jest.fn().mockResolvedValue('ok');
    await expect(withTransactionRetry(client(tx) as never, async () => 'ok')).resolves.toBe('ok');
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it('retries a deadlock then succeeds', async () => {
    const tx = jest
      .fn()
      .mockRejectedValueOnce(pgError('40P01'))
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2034' }))
      .mockResolvedValue('ok');
    await expect(withTransactionRetry(client(tx) as never, async () => 'ok')).resolves.toBe('ok');
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt bound', async () => {
    const tx = jest.fn().mockRejectedValue(pgError('40P01'));
    await expect(withTransactionRetry(client(tx) as never, async () => 'ok', 3)).rejects.toThrow();
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const tx = jest.fn().mockRejectedValue(new Error('Insufficient balance'));
    await expect(withTransactionRetry(client(tx) as never, async () => 'ok')).rejects.toThrow('Insufficient balance');
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
