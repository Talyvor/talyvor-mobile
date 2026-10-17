import AgentsWidget, { type AgentsWidgetProps } from './widgets/agents-widget'

export function pushWidget(props: AgentsWidgetProps) {
  AgentsWidget.updateSnapshot(props)
}
