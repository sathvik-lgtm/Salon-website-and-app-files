'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '../../auth';

export interface LoginState {
  error: string | null;
}

/** What a person reads when sign-in fails. Never says whether the email exists. */
const MESSAGES: Record<string, string> = {
  invalid: 'The email or password is not right. Please try again.',
  locked: 'Too many attempts. Please wait 15 minutes and try again.',
  captcha: 'We could not confirm you are not a robot. Please try again.',
  unavailable: 'Sign-in is not available right now. Please try again in a moment.',
};

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      turnstileToken: String(formData.get('turnstileToken') ?? ''),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as AuthError & { code?: string }).code ?? 'invalid';
      return { error: MESSAGES[code] ?? MESSAGES.invalid! };
    }
    throw error;
  }
  redirect('/'); // Next adds the /admin prefix
}
