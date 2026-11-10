package expo.modules.websession

import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.function.BiPredicate

/**
 * WebView sessions on Android (ADR-055), next to react-native-webview, which has no API for them:
 *
 * - Downloads: the patched `RNCWebViewManagerImpl.downloadInterceptor` (set here by reflection, as
 *   the content blocker does for requests) hands each download to JavaScript (`onDownload`, with the
 *   view's React tag and the cookies of the WebView's own profile) instead of DownloadManager; the
 *   app fetches the file into its own folder. Without the patch, DownloadManager keeps doing it.
 * - Private tabs: the patched `incognito` puts them in the "browser-private" profile where the
 *   WebView supports profiles; `clearPrivateProfile` wipes it when the private session ends.
 *   Elsewhere, `clearOrigins` deletes the storage and cookies of the sites visited in private.
 */
class WebSessionModule : Module() {
  private val interceptor = BiPredicate<WebView, Bundle> { view, details -> intercept(view, details) }

  override fun definition() = ModuleDefinition {
    Name("WebSession")
    Events("onDownload")

    OnCreate { install(interceptor) }
    OnDestroy { install(null) }

    Function("privateProfiles") { profilesSupported() }

    AsyncFunction("cookieHeader") { url: String, privateTab: Boolean ->
      cookieManager(privateTab)?.getCookie(url) ?: ""
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearPrivateProfile") { promise: Promise ->
      if (!profilesSupported()) return@AsyncFunction promise.resolve(false)
      val store = ProfileStore.getInstance()
      val profile = store.getProfile(PRIVATE_PROFILE) ?: return@AsyncFunction promise.resolve(true)
      profile.webStorage.deleteAllData()
      profile.cookieManager.removeAllCookies { _ ->
        profile.cookieManager.flush()
        // Deleting fails while a WebView still uses the profile; its data is gone either way.
        try {
          store.deleteProfile(PRIVATE_PROFILE)
        } catch (error: Exception) {
          Log.i(TAG, "Private profile kept: ${error.message}")
        }
        promise.resolve(true)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearOrigins") { origins: List<String> ->
      val cookies = CookieManager.getInstance()
      val storage = WebStorage.getInstance()
      for (origin in origins) {
        val uri = Uri.parse(origin)
        if (uri.scheme != "http" && uri.scheme != "https") continue
        val host = uri.host ?: continue
        storage.deleteOrigin(origin)
        val header = cookies.getCookie(origin) ?: continue
        val names = header.split(";").map { it.substringBefore("=").trim() }.filter { it.isNotEmpty() }.toSet()
        for (name in names) {
          for (domain in domainsOf(host)) {
            val scope = if (domain == null) "" else "; Domain=$domain"
            cookies.setCookie(origin, "$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/$scope")
          }
        }
      }
      cookies.flush()
      origins.size
    }.runOnQueue(Queues.MAIN)
  }

  private fun profilesSupported(): Boolean =
    try {
      WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    } catch (error: Exception) {
      false
    }

  private fun cookieManager(privateTab: Boolean): CookieManager? {
    if (!privateTab) return CookieManager.getInstance()
    if (!profilesSupported()) return CookieManager.getInstance()
    return ProfileStore.getInstance().getProfile(PRIVATE_PROFILE)?.cookieManager
  }

  /** The host itself (host-only cookie) and each parent domain a cookie may have been set for. */
  private fun domainsOf(host: String): List<String?> {
    val parts = host.split(".")
    val parents = (0 until (parts.size - 1).coerceAtLeast(0)).map { parts.drop(it).joinToString(".") }
    return listOf<String?>(null) + parents
  }

  private fun intercept(view: WebView, details: Bundle): Boolean {
    val url = details.getString("url") ?: return false
    if (!url.startsWith("http://") && !url.startsWith("https://")) return false
    val tag = (view.parent as? View)?.id ?: view.id
    val cookie = try {
      val manager = if (profilesSupported()) WebViewCompat.getProfile(view).cookieManager else CookieManager.getInstance()
      manager.getCookie(url) ?: ""
    } catch (error: Exception) {
      ""
    }
    sendEvent(
      "onDownload",
      mapOf(
        "tag" to tag,
        "url" to url,
        "userAgent" to (details.getString("userAgent") ?: ""),
        "contentDisposition" to (details.getString("contentDisposition") ?: ""),
        "mimeType" to (details.getString("mimeType") ?: ""),
        "contentLength" to details.getLong("contentLength", -1L).toDouble(),
        "cookie" to cookie,
      ),
    )
    return true
  }

  private fun install(value: BiPredicate<WebView, Bundle>?) {
    try {
      Class.forName("com.reactnativecommunity.webview.RNCWebViewManagerImpl").getField("downloadInterceptor").set(null, value)
    } catch (error: Exception) {
      Log.w(TAG, "react-native-webview is not patched (patch-package): downloads go to DownloadManager. ${error.message}")
    }
  }

  companion object {
    private const val TAG = "WebSession"
    private const val PRIVATE_PROFILE = "browser-private"
  }
}
