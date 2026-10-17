// expo-widgets 58 turns an Android widget tap into a broadcast to the widget's provider, which cannot open a link.
// It is listed before expo-widgets in app.json so its file is written last. This provider opens the app at any talyvor:// target instead, as the iOS widget's Link does; other taps go on as before.
const { AndroidConfig, withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const provider = (pkg) => `package ${pkg}

import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.widgets.ExpoWidgetsAppWidgetProvider

class TalyvorAgentsProvider : ExpoWidgetsAppWidgetProvider("TalyvorAgents") {
  override fun onReceive(context: Context, intent: Intent) {
    val target = intent.getStringExtra("expo.modules.widgets.extra.TARGET")
    if (intent.action == "expo.modules.widgets.ACTION_WIDGET_INTERACTION" && target != null && target.startsWith("talyvor://")) {
      context.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(target)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      return
    }
    super.onReceive(context, intent)
  }
}
`

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const pkg = AndroidConfig.Package.getPackage(config)
      const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'))
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'TalyvorAgentsProvider.kt'), provider(pkg))
      return config
    },
  ])
