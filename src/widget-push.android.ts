import type { AgentsWidgetProps } from './widgets/agents-widget'
import AgentsWidget from './widgets/agents-widget-android'

export function pushWidget(props: AgentsWidgetProps) {
  AgentsWidget.updateSnapshot(props)
}
