import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { gatewayView, type GatewayStatus, type ProfileCard } from './profiles-model.ts';

/** The badge of a profile's gateway: Hermes's status endpoint, else what the list said, else unknown. */
export function GatewayBadge({ card, status }: { card: ProfileCard; status: GatewayStatus | undefined }) {
  const view = gatewayView(status ?? { gateway_running: card.gatewayRunning });
  return <StatusBadge state={view.badge} label={`Gateway ${view.label.toLowerCase()}`} variant="plain" />;
}
