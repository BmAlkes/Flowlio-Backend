import { logger } from "./logger.util";
import axios from "axios";

export const toCents = (amount: number) => amount * 100;

export const validateMinimumThreshold = (
  options: {
    amount: number;
    exchangeRate: number;
    country: keyof typeof supportedCountries;
    convertToCents?: boolean;
  },
  callback: (error: Error | null, amount: number) => void
) => {
  const { amount, exchangeRate, country, convertToCents } = options;

  const rateToFiftyCentsEquivalent = Math.ceil(0.5 * Math.ceil(exchangeRate));
  const isMinimumThreshold = amount >= rateToFiftyCentsEquivalent;

  const error = new Error(
    `minimum amount should be ${rateToFiftyCentsEquivalent} ${supportedCountries[country]}`
  );

  callback(
    isMinimumThreshold ? null : error,
    convertToCents
      ? toCents(rateToFiftyCentsEquivalent)
      : rateToFiftyCentsEquivalent
  );
};

export const getExchangeRate = async (
  from: keyof typeof supportedCountries,
  to: keyof typeof supportedCountries
) => {
  try {
    const url = `https://open.er-api.com/v6/latest/${supportedCountries[from]}`;
    const response = await (await axios.get(url)).data;

    if (response.result === "success") {
      const rates = response.rates;
      return rates[supportedCountries[to]] as number;
    }
    throw new Error("exchange rate result unsuccessful");
  } catch (error) {
    logger.error(error);
    return null;
  }
};

export const supportedCountries = {
  Afghanistan: "AFN",
  Albania: "ALL",
  Algeria: "DZD",
  Andorra: "EUR",
  Angola: "AOA",
  AntiguaAndBarbuda: "XCD",
  Argentina: "ARS",
  Armenia: "AMD",
  Australia: "AUD",
  Austria: "EUR",
  Azerbaijan: "AZN",
  Bahamas: "BSD",
  Bahrain: "BHD",
  Bangladesh: "BDT",
  Barbados: "BBD",
  Belarus: "BYN",
  Belgium: "EUR",
  Belize: "BZD",
  Benin: "XOF",
  Bhutan: "BTN",
  Bolivia: "BOB",
  BosniaAndHerzegovina: "BAM",
  Botswana: "BWP",
  Brazil: "BRL",
  Brunei: "BND",
  Bulgaria: "BGN",
  BurkinaFaso: "XOF",
  Burundi: "BIF",
  CaboVerde: "CVE",
  Cambodia: "KHR",
  Cameroon: "XAF",
  Canada: "CAD",
  CentralAfricanRepublic: "XAF",
  Chad: "XAF",
  Chile: "CLP",
  China: "CNY",
  Colombia: "COP",
  Comoros: "KMF",
  Congo: "XAF",
  CostaRica: "CRC",
  Croatia: "HRK",
  Cyprus: "EUR",
  CzechRepublic: "CZK",
  DemocraticRepublicOfTheCongo: "CDF",
  Denmark: "DKK",
  Djibouti: "DJF",
  Dominica: "XCD",
  DominicanRepublic: "DOP",
  Ecuador: "USD",
  Egypt: "EGP",
  ElSalvador: "USD",
  EquatorialGuinea: "XAF",
  Eritrea: "ERN",
  Estonia: "EUR",
  Eswatini: "SZL",
  Ethiopia: "ETB",
  Fiji: "FJD",
  Finland: "EUR",
  France: "EUR",
  Gabon: "XAF",
  Gambia: "GMD",
  Georgia: "GEL",
  Germany: "EUR",
  Ghana: "GHS",
  Greece: "EUR",
  Grenada: "XCD",
  Guatemala: "GTQ",
  Guinea: "GNF",
  GuineaBissau: "XOF",
  Guyana: "GYD",
  Haiti: "HTG",
  Honduras: "HNL",
  Hungary: "HUF",
  Iceland: "ISK",
  India: "INR",
  Indonesia: "IDR",
  Ireland: "EUR",
  Israel: "ILS",
  Italy: "EUR",
  IvoryCoast: "XOF",
  Jamaica: "JMD",
  Japan: "JPY",
  Jordan: "JOD",
  Kazakhstan: "KZT",
  Kenya: "KES",
  Kiribati: "AUD",
  Kuwait: "KWD",
  Kyrgyzstan: "KGS",
  Laos: "LAK",
  Latvia: "EUR",
  Lebanon: "LBP",
  Lesotho: "LSL",
  Liberia: "LRD",
  Libya: "LYD",
  Liechtenstein: "CHF",
  Lithuania: "EUR",
  Luxembourg: "EUR",
  Madagascar: "MGA",
  Malawi: "MWK",
  Malaysia: "MYR",
  Maldives: "MVR",
  Mali: "XOF",
  Malta: "EUR",
  MarshallIslands: "USD",
  Mauritania: "MRO",
  Mauritius: "MUR",
  Mexico: "MXN",
  Micronesia: "USD",
  Moldova: "MDL",
  Monaco: "EUR",
  Mongolia: "MNT",
  Montenegro: "EUR",
  Morocco: "MAD",
  Mozambique: "MZN",
  Myanmar: "MMK",
  Namibia: "NAD",
  Nauru: "AUD",
  Nepal: "NPR",
  Netherlands: "EUR",
  NewZealand: "NZD",
  Nicaragua: "NIO",
  Niger: "XOF",
  Nigeria: "NGN",
  NorthMacedonia: "MKD",
  Norway: "NOK",
  Oman: "OMR",
  Pakistan: "PKR",
  Palau: "USD",
  Panama: "USD",
  PapuaNewGuinea: "PGK",
  Paraguay: "PYG",
  Peru: "PEN",
  Philippines: "PHP",
  Poland: "PLN",
  Portugal: "EUR",
  Qatar: "QAR",
  Romania: "RON",
  Russia: "RUB",
  Rwanda: "RWF",
  SaintKittsAndNevis: "XCD",
  SaintLucia: "XCD",
  SaintVincentAndTheGrenadines: "XCD",
  Samoa: "WST",
  SanMarino: "EUR",
  SaoTomeAndPrincipe: "STN",
  SaudiArabia: "SAR",
  Senegal: "XOF",
  Serbia: "RSD",
  Seychelles: "SCR",
  SierraLeone: "SLL",
  Singapore: "SGD",
  Slovakia: "EUR",
  Slovenia: "EUR",
  SolomonIslands: "SBD",
  Somalia: "SOS",
  SouthAfrica: "ZAR",
  SouthKorea: "KRW",
  SouthSudan: "SSP",
  Spain: "EUR",
  SriLanka: "LKR",
  Sudan: "SDG",
  Suriname: "SRD",
  Sweden: "SEK",
  Switzerland: "CHF",
  Syria: "SYP",
  Taiwan: "TWD",
  Tajikistan: "TJS",
  Tanzania: "TZS",
  Thailand: "THB",
  TimorLeste: "USD",
  Togo: "XOF",
  Tonga: "TOP",
  TrinidadAndTobago: "TTD",
  Tunisia: "TND",
  Turkey: "TRY",
  Turkmenistan: "TMT",
  Tuvalu: "AUD",
  Uganda: "UGX",
  Ukraine: "UAH",
  UnitedArabEmirates: "AED",
  UnitedKingdom: "GBP",
  UnitedStates: "USD",
  Uruguay: "UYU",
  Uzbekistan: "UZS",
  Vanuatu: "VUV",
  VaticanCity: "EUR",
  Venezuela: "VES",
  Vietnam: "VND",
  Yemen: "YER",
  Zambia: "ZMW",
  Zimbabwe: "ZWL",
};
