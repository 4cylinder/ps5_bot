import { getNotificationsInformation } from '@core/configs';
import { Webhook, MessageBuilder } from 'discord-webhook-node';

const config = getNotificationsInformation().discord;
const hooks: { [key: string]: Webhook } = {};
for (let key in config) {
  hooks[key] = new Webhook(config[key])
}

interface MessageProperties {
  color?: number;
  image?: string;
  key?: string;
  message: string;
  title?: string;
}

export const sendMessage = async (props: MessageProperties) => {
  const embed = new MessageBuilder().setDescription(props.message);

  embed.setText('@here');

  if (props.title){
    embed.setTitle(props.title);
  }

  if (props.color) {
    embed.setColor(props.color);
  }

  const retailer = props.key || 'bestbuy';
  await hooks[retailer].send(embed);

  if (props.image) {
    await hooks[retailer].sendFile(props.image);
  } 
};
