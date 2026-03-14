/**
 * Email Service
 *
 * AWS SES-based email delivery for sending recovery passwords to OAuth users.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { Logger } from 'pino';

export interface EmailConfig {
  /** AWS SES region (e.g., 'us-east-1') */
  region: string;
  /** AWS access key ID (optional — uses instance profile if omitted) */
  accessKeyId?: string;
  /** AWS secret access key (required when accessKeyId is provided) */
  secretAccessKey?: string;
  /** Verified sender email address or domain identity in SES */
  fromAddress: string;
}

export interface EmailService {
  sendRecoveryPassword(toEmail: string, recoveryPassword: string): Promise<void>;
}

export function createEmailService(config: EmailConfig, log: Logger): EmailService {
  const client = new SESClient({
    region: config.region,
    ...(config.accessKeyId && {
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey!,
      },
    }),
  });

  return {
    async sendRecoveryPassword(toEmail: string, recoveryPassword: string): Promise<void> {
      const command = new SendEmailCommand({
        Source: config.fromAddress,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: 'Your NEAR Account Recovery Password' },
          Body: {
            Text: {
              Data: `Your recovery password is: ${recoveryPassword}\n\nStore this securely. You will need it to recover your account if you lose your device.`,
            },
          },
        },
      });

      try {
        await client.send(command);
        log.info({ to: toEmail }, 'Recovery password email sent');
      } catch (err) {
        log.error({ err }, 'Failed to send recovery email');
        throw err;
      }
    },
  };
}
