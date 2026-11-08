import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../api/PolkadotApi'
import { DryRunFailedError } from '../errors'
import type { TBatchedTransferOptions, TDryRunResult, TTransferBaseOptions } from '../types'
import { BatchMode } from '../types'
import { assertSender, createTransferOrSwap, isConfig } from '../utils'
import BatchTransactionManager from './BatchTransactionManager'
import { buildDryRun } from './buildDryRun'
import type { GeneralBuilder } from './Builder'

vi.mock('../utils')
vi.mock('./buildDryRun')

const mockApi = {
  init: vi.fn(),
  getApi: vi.fn(),
  callBatchMethod: vi.fn(),
  config: {}
} as unknown as PolkadotApi<unknown, unknown, unknown>

const createBuilder = () =>
  ({
    createTxFactory: vi.fn(() => vi.fn())
  }) as unknown as GeneralBuilder<
    unknown,
    unknown,
    unknown,
    TTransferBaseOptions<unknown, unknown, unknown>
  >

const createTransferOptions = (
  overrides: Partial<TBatchedTransferOptions<unknown, unknown, unknown>> = {}
): TBatchedTransferOptions<unknown, unknown, unknown> => ({
  from: 'Acala',
  api: mockApi,
  to: 'Hydration',
  currency: { symbol: 'ACA', amount: 100 },
  recipient: 'address',
  builder: createBuilder(),
  ...overrides
})

describe('BatchTransactionManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('addTransaction', () => {
    it('adds a transaction to the manager', () => {
      const manager = new BatchTransactionManager()
      expect(manager.isEmpty()).toBe(true)
      manager.addTransaction(createTransferOptions())
      expect(manager.isEmpty()).toBe(false)
    })
  })

  describe('isEmpty', () => {
    it('returns true when no transactions have been added', () => {
      const manager = new BatchTransactionManager()
      expect(manager.isEmpty()).toBe(true)
    })

    it('returns false when transactions are present', () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      expect(manager.isEmpty()).toBe(false)
    })
  })

  describe('buildBatch', () => {
    it('throws an error if there are no transactions', async () => {
      const manager = new BatchTransactionManager()
      await expect(
        manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      ).rejects.toThrow('No transactions to batch.')
    })

    it('calls sendTransaction for each added transaction and batches them with batchAll', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      expect(createTransferOrSwap).toHaveBeenCalledTimes(2)
    })

    it('uses batch when BATCH mode is selected', async () => {
      const spy = vi.spyOn(mockApi, 'callBatchMethod')
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH })

      expect(spy).toHaveBeenCalled()
    })

    it('uses batchAll when BATCH_ALL mode is selected', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })

      expect(createTransferOrSwap).toHaveBeenCalled()
    })

    it('should fail if different origins are used', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      manager.addTransaction(createTransferOptions({ from: 'Karura' }))
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await expect(
        manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      ).rejects.toThrow('All transactions must have the same origin.')
    })

    it('runs xcmFormatCheck dry run on each batched transaction when enabled', async () => {
      const manager = new BatchTransactionManager()
      const tx1 = { hash: 'hash1' }
      const tx2 = { hash: 'hash2' }
      manager.addTransaction(createTransferOptions({ sender: 'sender-1' }))
      manager.addTransaction(createTransferOptions({ sender: 'sender-2', to: 'Moonbeam' }))
      vi.mocked(createTransferOrSwap).mockResolvedValueOnce(tx1).mockResolvedValueOnce(tx2)
      vi.mocked(isConfig).mockReturnValue(true)
      vi.spyOn(mockApi, 'config', 'get').mockReturnValue({ xcmFormatCheck: true })
      vi.mocked(buildDryRun).mockResolvedValue({} as TDryRunResult)

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })

      expect(assertSender).toHaveBeenCalledWith('sender-1')
      expect(assertSender).toHaveBeenCalledWith('sender-2')
      expect(buildDryRun).toHaveBeenCalledTimes(2)
      expect(buildDryRun).toHaveBeenNthCalledWith(
        1,
        mockApi,
        tx1,
        expect.objectContaining({ from: 'Acala', to: 'Hydration', sender: 'sender-1' }),
        { sentAssetMintMode: 'bypass' }
      )
      expect(buildDryRun).toHaveBeenNthCalledWith(
        2,
        mockApi,
        tx2,
        expect.objectContaining({ from: 'Acala', to: 'Moonbeam', sender: 'sender-2' }),
        { sentAssetMintMode: 'bypass' }
      )
    })

    it('throws DryRunFailedError when xcmFormatCheck fails for a batched transaction', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions({ sender: 'sender-1' }))
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash1' })
      vi.mocked(isConfig).mockReturnValue(true)
      vi.spyOn(mockApi, 'config', 'get').mockReturnValue({ xcmFormatCheck: true })
      vi.mocked(buildDryRun).mockResolvedValue({
        dryRunError: { reason: 'Barrier', chain: 'Hydration' }
      } as TDryRunResult)

      const batchPromise = manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })

      await expect(batchPromise).rejects.toBeInstanceOf(DryRunFailedError)
      await expect(batchPromise).rejects.toMatchObject({
        dryRunError: { reason: 'Barrier' },
        message: 'XCM format check failed. Dry run on Hydration failed: Barrier'
      })
    })
  })
})
