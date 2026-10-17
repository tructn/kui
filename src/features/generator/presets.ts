import type { RecordTemplate } from "./types";

export interface Preset {
  label: string;
  template: Omit<RecordTemplate, "locale">;
}

/** Starting points for common kinds of events. Users can edit them freely. */
export const PRESETS: Preset[] = [
  {
    label: "E-commerce orders",
    template: {
      key: "order-{{seq}}",
      value: `{
  "orderId": {{seq}},
  "customer": {
    "name": "{{name}}",
    "email": "{{email}}",
    "city": "{{city}}",
    "country": "{{country_code}}"
  },
  "product": "{{pick Keyboard Mouse Monitor Laptop Headphones}}",
  "quantity": {{int 1 5}},
  "price": {{float 5 500 2}},
  "currency": "{{pick USD EUR GBP}}",
  "status": "{{pick new paid shipped delivered cancelled}}",
  "createdAt": "{{now_iso}}"
}`,
      headers: [{ key: "event-type", value: "order.created" }],
    },
  },
  {
    label: "User sign-ups",
    template: {
      key: "{{uuid}}",
      value: `{
  "firstName": "{{first_name}}",
  "lastName": "{{last_name}}",
  "email": "{{email}}",
  "username": "{{username}}",
  "phone": "{{phone}}",
  "company": "{{company}}",
  "jobTitle": "{{job_title}}",
  "address": {
    "street": "{{street}}",
    "city": "{{city}}",
    "zip": "{{zip}}",
    "country": "{{country}}"
  },
  "marketingOptIn": {{bool 30}},
  "signedUpAt": "{{datetime 365}}"
}`,
      headers: [],
    },
  },
  {
    label: "Clickstream",
    template: {
      key: "session-{{hex 12}}",
      value: `{
  "userId": {{int 1 5000}},
  "event": "{{pick page_view click scroll add_to_cart purchase}}",
  "page": "{{pick / /products /products/42 /cart /checkout}}",
  "ip": "{{ipv4}}",
  "userAgent": "{{user_agent}}",
  "ts": {{now}}
}`,
      headers: [],
    },
  },
  {
    label: "IoT sensor readings",
    template: {
      key: "sensor-{{int 1 20}}",
      value: `{
  "temperature": {{float 18 32 1}},
  "humidity": {{int 30 90}},
  "battery": {{int 0 100}},
  "lat": {{latitude}},
  "lon": {{longitude}},
  "ts": {{now}}
}`,
      headers: [],
    },
  },
  {
    label: "Payments",
    template: {
      key: "{{uuid}}",
      value: `{
  "account": "{{digits "ACC-########"}}",
  "amount": {{float 1 2000 2}},
  "currency": "{{currency}}",
  "method": "{{pick card bank_transfer wallet}}",
  "succeeded": {{bool 95}},
  "at": "{{now_iso}}"
}`,
      headers: [{ key: "source", value: "kui-generator" }],
    },
  },
];
