import AppShell from '@/app/components/AppShell';
import { AuthProvider } from '@/app/context/AuthContext';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}