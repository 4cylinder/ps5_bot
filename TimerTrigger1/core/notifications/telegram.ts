import { getNotificationsInformation } from '../configs';
import { TelegramClient } from 'messaging-api-telegram';

const config = getNotificationsInformation().telegram;

const client = new TelegramClient({
  accessToken: config.token
});

interface MessageProperties {
  message: string;
}

export const sendMessage = async ({ message }: MessageProperties) => {
  await client.sendMessage(config.chatId, message);
};
