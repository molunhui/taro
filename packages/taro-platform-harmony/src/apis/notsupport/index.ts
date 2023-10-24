import { temporarilyNotSupport } from '../utils'

/** storage:start **/
export const getStorageSync = temporarilyNotSupport('getStorageSync', 'getStorage')
export const setStorageSync = temporarilyNotSupport('setStorageSync', 'setStorage')
export const clearStorageSync = temporarilyNotSupport('clearStorageSync', 'clearStorage')
export const removeStorageSync = temporarilyNotSupport('removeStorageSync', 'removeStorage')
/** storage:end **/


/** wx:start **/
export const login = temporarilyNotSupport('login')
export const requirePlugin = temporarilyNotSupport('requirePlugin')
export const getUpdateManager = temporarilyNotSupport('getUpdateManager')
export const getAccountInfoSync = temporarilyNotSupport('getAccountInfoSync')
export const navigateToMiniProgram = temporarilyNotSupport('navigateToMiniProgram')
export const requestSubscribeMessage = temporarilyNotSupport('requestSubscribeMessage')
export const getMenuButtonBoundingClientRect = temporarilyNotSupport('getMenuButtonBoundingClientRect')
/** wx:end **/

/** media:start **/
export const previewImage = temporarilyNotSupport('previewImage')
export const saveImageToPhotosAlbum = temporarilyNotSupport('saveImageToPhotosAlbum')
/** media:end **/