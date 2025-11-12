import * as Brevo from "@getbrevo/brevo";
import { env } from "@/utils/env.util";

export const brevoTransactionApi = new Brevo.TransactionalEmailsApi();
const brevoContactsApi = new Brevo.ContactsApi();

export const sendEmail = brevoTransactionApi.sendTransacEmail;

brevoTransactionApi.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  env.BREVO_API_KEY
);

brevoContactsApi.setApiKey(Brevo.ContactsApiApiKeys.apiKey, env.BREVO_API_KEY);
