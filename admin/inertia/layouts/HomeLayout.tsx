import { useState } from 'react'
import {
  IconArrowBigUpLines,
  IconBuildingStore,
  IconCarrot,
  IconChartBar,
  IconDashboard,
  IconFolder,
  IconGavel,
  IconHeart,
  IconHome,
  IconMapRoute,
  IconSettings,
  IconWand,
  IconZoom,
} from '@tabler/icons-react'
import { usePage } from '@inertiajs/react'
import StyledSidebar from '~/components/StyledSidebar'
import CandidateDriveBanner from '~/components/CandidateDriveBanner'
import ChatButton from '~/components/chat/ChatButton'
import ChatModal from '~/components/chat/ChatModal'
import { getServiceLink } from '~/lib/navigation'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import { SERVICE_NAMES } from '../../constants/service_names'

/**
 * HomeLayout — the Command Center home's shell.
 *
 * Mirrors SettingsLayout (the shared StyledSidebar shell) so the home and
 * Settings share one chrome. AppLayout (the sidebar-less big-logo landing) is
 * still used by ~14 other pages — about, mesh, workshop, drug-reference,
 * readiness, conditions, easy-setup, inventory, plans — so it is left untouched;
 * only home.tsx points here.
 *
 * The nav prepends a "Command Center" entry (active on /home) then reuses the
 * Settings nav items so every destination lives in the rail. The AI-assistant
 * entry and the ChatButton/ChatModal stay gated on the nomad_ollama row being
 * installed, matching AppLayout's prior behavior.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const aiAssistantInstallStatus = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)

  const navigation = [
    { name: 'Command Center', href: '/home', icon: IconHome, current: true },
    ...(aiAssistantInstallStatus.isInstalled
      ? [{ name: aiAssistantName, href: '/settings/models', icon: IconWand, current: false }]
      : []),
    { name: 'Supply Depot', href: '/settings/apps', icon: IconBuildingStore, current: false },
    { name: 'Benchmark', href: '/settings/benchmark', icon: IconChartBar, current: false },
    { name: 'Content Explorer', href: '/settings/zim/remote-explorer', icon: IconZoom, current: false },
    { name: 'Content Manager', href: '/settings/zim', icon: IconFolder, current: false },
    { name: 'Grocy', href: '/settings/grocy', icon: IconCarrot, current: false },
    { name: 'Maps Manager', href: '/settings/maps', icon: IconMapRoute, current: false },
    {
      name: 'Service Logs & Metrics',
      href: getServiceLink('9999'),
      icon: IconDashboard,
      current: false,
      target: '_blank',
    },
    {
      name: 'Check for Updates',
      href: '/settings/update',
      icon: IconArrowBigUpLines,
      current: false,
    },
    { name: 'System', href: '/settings/system', icon: IconSettings, current: false },
    { name: 'Support the Project', href: '/settings/support', icon: IconHeart, current: false },
    { name: 'Legal Notices', href: '/settings/legal', icon: IconGavel, current: false },
  ]

  return (
    <div className="min-h-screen flex flex-row bg-stone-50/90">
      <StyledSidebar title="Command Center" items={navigation} />
      <div className="flex-1 flex flex-col min-w-0">
        <CandidateDriveBanner />
        {children}
      </div>

      {aiAssistantInstallStatus.isInstalled && (
        <>
          <ChatButton onClick={() => setIsChatOpen(true)} />
          <ChatModal open={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </>
      )}
    </div>
  )
}
