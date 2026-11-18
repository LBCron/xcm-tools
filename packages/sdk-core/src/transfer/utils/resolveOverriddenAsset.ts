import {
  InvalidCurrencyError,
  normalizeLocation,
  type TAssetInfo,
  type TAssetWithFee
} from '@paraspell/assets'

import type { TSubstrateTransferOptions } from '../../types'
import { createAsset, pickCompatibleXcmVersion, sortAssets } from '../../utils'
import { resolveCurrency } from './resolveCurrency'
import { validateAssetSupport } from './validateAssetSupport'

export const resolveOverriddenAsset = <TApi, TRes, TSigner, TCustomChain extends string = never>(
  options: TSubstrateTransferOptions<TApi, TRes, TSigner, TCustomChain>,
  isBridge: boolean,
  assetCheckEnabled: boolean,
  resolvedFeeAsset: TAssetInfo | undefined
): TAssetWithFee[] | undefined => {
  const { api, currency, feeAsset, from: origin, to: destination, version: customVersion } = options

  if (Array.isArray(currency)) {
    if (!feeAsset) {
      throw new InvalidCurrencyError(
        'Overridden assets cannot be used without specifying fee asset'
      )
    }

    const version = pickCompatibleXcmVersion(api, origin, destination, customVersion)

    const { assets } = resolveCurrency(
      api,
      currency,
      resolvedFeeAsset,
      origin,
      destination,
      asset => validateAssetSupport(options, assetCheckEnabled, isBridge, asset)
    )

    return sortAssets(
      assets.map(asset => ({
        isFeeAsset: asset.isFeeAsset,
        ...createAsset(version, asset.amount, normalizeLocation(asset.location, version))
      }))
    )
  }

  return undefined
}
