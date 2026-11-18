import type { TAsset, TAssetInfo } from '@paraspell/assets'
import { isAssetEqual, normalizeLocation } from '@paraspell/assets'
import type { TLocation } from '@paraspell/sdk-common'
import { isTLocation, Version } from '@paraspell/sdk-common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../../api'
import type { TSubstrateTransferOptions } from '../../types'
import { abstractDecimals, createAsset, pickCompatibleXcmVersion, sortAssets } from '../../utils'
import { resolveOverriddenAsset } from './resolveOverriddenAsset'
import { validateAssetSupport } from './validateAssetSupport'

vi.mock('../../utils')
vi.mock('./validateAssetSupport')

vi.mock('@paraspell/sdk-common', async importActual => ({
  ...(await importActual()),
  isTLocation: vi.fn()
}))
vi.mock('@paraspell/assets', () => ({
  isAssetEqual: vi.fn(),
  normalizeLocation: vi.fn((location: TLocation) => location),
  extractAssetLocation: vi.fn().mockResolvedValue({}),
  InvalidCurrencyError: class extends Error {}
}))

describe('resolveOverriddenAsset', () => {
  const mockOrigin = 'Acala'
  const mockDestination = {} as TLocation

  const mockApi = {
    findAssetInfo: vi.fn()
  } as unknown as PolkadotApi<unknown, unknown, unknown>

  const defaultOptions = {
    api: mockApi,
    currency: { symbol: 'TEST', amount: '1000' },
    from: mockOrigin,
    to: mockDestination
  } as TSubstrateTransferOptions<unknown, unknown, unknown>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isTLocation).mockReturnValue(false)
    vi.mocked(createAsset).mockReturnValue({} as TAsset)
    vi.spyOn(mockApi, 'findAssetInfo').mockReturnValue({
      location: {}
    } as TAssetInfo)
    vi.mocked(abstractDecimals).mockImplementation(amount => BigInt(amount))
    vi.mocked(sortAssets).mockImplementation(assets => assets)
    vi.mocked(pickCompatibleXcmVersion).mockReturnValue(Version.V4)
    vi.mocked(normalizeLocation).mockImplementation(location => location)
  })

  it('resolves currencies by fetching assets when not all items are TAsset', () => {
    const assets = [
      { symbol: 'ASSET1', amount: 1000n },
      { symbol: 'ASSET2', amount: 2000n }
    ]
    const options = {
      ...defaultOptions,
      currency: assets,
      feeAsset: { symbol: 'ASSET2' }
    }

    vi.mocked(isTLocation).mockReturnValue(false)
    vi.mocked(isAssetEqual).mockReturnValueOnce(false).mockReturnValueOnce(true)

    const spy = vi.spyOn(mockApi, 'findAssetInfo')

    const result = resolveOverriddenAsset(options, false, true, { symbol: 'DOT' } as TAssetInfo)

    expect(validateAssetSupport).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledTimes(assets.length)
    expect(createAsset).toHaveBeenCalledTimes(assets.length)
    expect(result).toEqual([
      {
        isFeeAsset: false
      },
      {
        isFeeAsset: true
      }
    ])
  })

  it('throws an InvalidCurrencyError if a currency array is provided without a fee asset', () => {
    const options = {
      ...defaultOptions,
      currency: [{}, {}]
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    expect(() => resolveOverriddenAsset(options, false, false, {} as TAssetInfo)).toThrow(
      'Overridden assets cannot be used without specifying fee asset'
    )
  })

  it('returns undefined if currency is not an array', () => {
    const options = {
      ...defaultOptions,
      currency: { symbol: 'NO_OVERRIDE' }
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    const result = resolveOverriddenAsset(options, false, false, {} as TAssetInfo)
    expect(result).toBeUndefined()
  })

  it('uses pickCompatibleXcmVersion and normalizes asset locations for target XCM version', () => {
    const rawLocation: TLocation = { parents: 1, interior: { X1: [{ Parachain: 1000 }] } }
    const normalizedV3Location: TLocation = { parents: 1, interior: { X1: { Parachain: 1000 } } }
    vi.spyOn(mockApi, 'findAssetInfo').mockReturnValue({
      symbol: 'USDT',
      decimals: 6,
      location: rawLocation
    } as TAssetInfo)
    vi.mocked(isAssetEqual).mockReturnValue(true)
    vi.mocked(pickCompatibleXcmVersion).mockReturnValue(Version.V3)
    vi.mocked(normalizeLocation).mockReturnValue(normalizedV3Location)

    const options = {
      ...defaultOptions,
      currency: [{ symbol: 'USDT', amount: 1000n }],
      feeAsset: { symbol: 'USDT' },
      version: Version.V3
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    resolveOverriddenAsset(options, false, true, {
      symbol: 'USDT',
      location: rawLocation
    } as TAssetInfo)

    expect(pickCompatibleXcmVersion).toHaveBeenCalledWith(
      mockApi,
      mockOrigin,
      mockDestination,
      Version.V3
    )
    expect(normalizeLocation).toHaveBeenCalledWith(rawLocation, Version.V3)
    expect(createAsset).toHaveBeenCalledWith(Version.V3, 1000n, normalizedV3Location)
  })
})
