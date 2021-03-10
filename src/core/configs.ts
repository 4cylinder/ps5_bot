import Tasks from '@config/tasks.json';
import customerInformation from '@config/customer.json';
import paymentInformation from '@config/payment.json';
import loginInformation from '@config/login.json';
import notificationsInformation from '@config/notifications.json';

export interface CustomerInformation {
  address: string;
  addressSecondLine?: string;
  budget: number;
  city: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  province: string;
  postalCode: string;
}

export interface PaymentInformation {
  creditCardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
  address: string;
  city: string;
  firstName: string;
  lastName: string;
  province: string;
  postalCode: string;
}

export interface LoginInformation {
  email: string;
  password: string;
}

export const getTasks = () => {
  return Tasks;
};

export const getCustomerInformation = (): CustomerInformation => {
  return customerInformation;
};

export const getPaymentInformation = (): PaymentInformation => {
  return paymentInformation;
};

export const getNotificationsInformation = (): any => {
  return notificationsInformation;
};

export const getLoginInformation = () => {
  return loginInformation;
};
