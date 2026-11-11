import { isLoginFailure, LoginPanel } from "@/features/auth/LoginPanel";

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

function singleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <main className="ap-main ap-main--center" data-testid="login-page">
      <LoginPanel failed={isLoginFailure(singleParam(params.error))} />
    </main>
  );
}
