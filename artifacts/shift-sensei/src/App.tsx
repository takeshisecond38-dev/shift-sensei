import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';
import PinGate from '@/components/PinGate';
import AppShell from '@/components/layout/AppShell';
import ShiftsPage from '@/pages/shifts';
import ShiftSenseiPage from '@/pages/shift-sensei';
import AiConsultPage from '@/pages/shift-sensei/ai-consult';
import RecommendationsPage from '@/pages/shift-sensei/recommendations';
import MonthEndCheckPage from '@/pages/shift-sensei/month-end-check';
import SettingsPage from '@/pages/settings';
import ShiftTypesPage from '@/pages/settings/shift-types';
import MonthEndCheckSettingsPage from '@/pages/settings/month-end-check';
import FacilityRulesPage from '@/pages/settings/facility-rules';
import DataManagementPage from '@/pages/settings/data-management';
import StaffPage from '@/pages/staff';
import ExportPage from '@/pages/export';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={ShiftsPage} />
        <Route path="/shifts" component={ShiftsPage} />
        <Route path="/shift-sensei" component={ShiftSenseiPage} />
        <Route path="/shift-sensei/ai-consult" component={AiConsultPage} />
        <Route path="/shift-sensei/recommendations" component={RecommendationsPage} />
        <Route path="/shift-sensei/month-end-check" component={MonthEndCheckPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/settings/shift-types" component={ShiftTypesPage} />
        <Route path="/settings/month-end-check" component={MonthEndCheckSettingsPage} />
        <Route path="/settings/facility-rules" component={FacilityRulesPage} />
        <Route path="/settings/data-management" component={DataManagementPage} />
        <Route path="/staff" component={StaffPage} />
        <Route path="/export" component={ExportPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <PinGate>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster position="top-center" />
      </QueryClientProvider>
    </PinGate>
  );
}

export default App;
