import AppShell from '@/app/components/shared/AppShell';
import { AuthProvider } from '@/app/context/AuthContext';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}