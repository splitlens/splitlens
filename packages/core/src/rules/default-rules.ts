/**
 * Default categorization ruleset for SplitLens.
 *
 * Order matters: first match wins. Curated against ~2000 real HDFC transactions
 * from a year of statements; achieves ~76% auto-categorization out of the box,
 * with the remainder being one-off P2P transfers that the user can tag manually.
 *
 * Rules are split into priority bands so future user-added rules can override:
 *   10-19  Income (most specific employer matches first)
 *   20-29  Investments
 *   30-39  Bills + Household + recurring people the user has confirmed
 *   40-49  Subscriptions
 *   50-69  Food / Personal habits / Local vendors
 *   70-79  Transport / Shopping / Health / Travel
 *   80-89  Cash / Charges / Tax
 *   90-99  Family / Friends transfers
 *   100+   Generic fallbacks
 */

import type { CategoryRule } from "./index";

export const DEFAULT_RULES: CategoryRule[] = [
  // === INCOME (most specific employer matches first) ===
  { pattern: "NEFTCR-CHAS|CISCOSYSTEMS", category: "Income:Salary (Cisco)", priority: 10 },
  { pattern: "USEFULBI", category: "Income:Salary (UsefulBI)", priority: 10 },
  // Bare 'SALARY' (no sender) = newer employer's payroll format
  { pattern: "^SALARY", category: "Income:Salary (Other)", priority: 12 },
  { pattern: "NEFTCR.*SALARY", category: "Income:Salary (Other)", priority: 13 },
  { pattern: "INTERESTPAID|INT\\.PD|INT\\.CR", category: "Income:Interest", priority: 15 },
  { pattern: "^NEFTCR-(?!CHAS)", category: "Income:Other (NEFT)", priority: 18 },
  { pattern: "^IMPS-.*-CR$|IMPS.*INWARD", category: "Income:Other (IMPS)", priority: 18 },
  { pattern: "^UPIRET", category: "Income:Refund", priority: 18 },

  // === INVESTMENTS ===
  {
    pattern: "FDBOOKED|FD ?BOOKED|FIXED ?DEPOSIT",
    category: "Investment:Fixed Deposit",
    priority: 20,
  },
  { pattern: "^SWEEP", category: "Investment:FD Sweep", priority: 20 },
  { pattern: "MUTUAL.?FUND|BSEMF|NSEMF|MFSS", category: "Investment:Mutual Fund", priority: 22 },
  { pattern: "BILLIONBRAINSGARAGE|GROWW", category: "Investment:Mutual Fund", priority: 22 }, // Groww's parent co
  { pattern: "ZERODHA|UPSTOX|KITE|CDSL|NSDL", category: "Investment:Equity", priority: 22 },
  { pattern: "NPS-|NPSCRA|NPSCONTR", category: "Investment:NPS", priority: 22 },
  { pattern: "PPF|RECURRINGDEPOSIT|^RD ", category: "Investment:PPF/RD", priority: 22 },

  // === SELF / CARD PAYMENTS ===
  { pattern: "CC0\\d+", category: "Transfer:Credit Card Payment", priority: 25 },
  { pattern: "CREDIT.?CARD.?PAY|CARDPAY", category: "Transfer:Credit Card Payment", priority: 25 },

  // === KNOWN UTILITY-COLLECTING CONTACTS (user-confirmed; before generic Bills) ===
  { pattern: "RAHULKUMAR.*ELECTRICITY", category: "Bills:Electricity", priority: 28 },
  // Rahul Kumar — flatmate. Same person across three UPI handles
  // (9525680445@YBL, 9525680445@AXL, RAHUL.GR8DPS@OKHDFCBANK).
  // Excludes BharatPe merchant "RAHUL-BHARATPE..." and "RAHULKUMARSINGH-6206785781".
  {
    pattern: "RAHUL.*?(9525680445|RAHUL\\.GR8DPS)",
    category: "Bills:Rent (flatmate share)",
    priority: 28,
  },
  // BETHPRASAD KADEL — domestic help, ~₹9K/mo
  { pattern: "BETHPRASAD ?KADEL|BEDKADEL", category: "Household:Domestic Help", priority: 28 },

  // === BILLS / UTILITIES ===
  {
    pattern: "ELECTRICITYBILL|BESCOM|ESCOM|BBPS-?ELEC",
    category: "Bills:Electricity",
    priority: 30,
  },
  {
    pattern: "BHARATGAS|HPGAS|INDANE|GASCYLINDER|GASBOOK",
    category: "Bills:Cooking Gas",
    priority: 30,
  },
  {
    pattern: "AIRTEL|JIO|VODAFONE|VI[ -]?BILL|RECHARGE",
    category: "Bills:Mobile/Internet",
    priority: 30,
  },
  {
    pattern: "ACTFIBERNET|ACTBROADBAND|HATHWAY|BROADBAND",
    category: "Bills:Internet",
    priority: 30,
  },
  { pattern: "WATERBILL|BWSSB|JALBOARD", category: "Bills:Water", priority: 30 },
  { pattern: "RENT|LANDLORD|HOUSERENT", category: "Bills:Rent", priority: 32 },
  // Loan EMI rows on credit card statements
  { pattern: "OFFUS EMI,PRIN", category: "Bills:Loan EMI Principal", priority: 35 },
  { pattern: "OFFUS EMI,INT|OFFUS EMI,INT NBR", category: "Bills:Loan EMI Interest", priority: 35 },
  { pattern: "EMI ", category: "Bills:Loan EMI", priority: 38 },

  // === SUBSCRIPTIONS ===
  {
    pattern: "APPLEMEDIASERVICES|APPLESERVICES|APPLE\\.COM",
    category: "Subscription:Apple",
    priority: 40,
  },
  { pattern: "SPOTIFY", category: "Subscription:Spotify", priority: 40 },
  { pattern: "NETFLIX", category: "Subscription:Netflix", priority: 40 },
  { pattern: "PRIMEVIDEO|AMAZONPRIME", category: "Subscription:Amazon Prime", priority: 40 },
  {
    pattern: "GOOGLEINDIADIGITAL|GOOGLE.*INDIA|YOUTUBE.*PREM|GOOGLE.*ONE|GOOGLEPLAY",
    category: "Subscription:Google",
    priority: 40,
  },
  { pattern: "OPENAI|CHATGPT", category: "Subscription:OpenAI", priority: 40 },
  { pattern: "ANTHROPIC|CLAUDE\\.AI", category: "Subscription:Claude", priority: 40 },
  {
    pattern: "GITHUB|VERCEL|DIGITALOCEAN|HEROKU|FLY\\.IO",
    category: "Subscription:Software",
    priority: 42,
  },
  {
    pattern: "CURSOR|JETBRAINS|FIGMA|NOTION|LINEAR",
    category: "Subscription:Software",
    priority: 42,
  },
  {
    pattern: "CULT\\.FIT|CULT ?FIT|CURE\\.FIT|GOLDSGYM",
    category: "Subscription:Fitness",
    priority: 42,
  },

  // === FOOD: QUICK COMMERCE / DELIVERY / RESTAURANTS ===
  { pattern: "BLINKIT|GROFERS", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "ZEPTO", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "BIGBASKET", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "INSTAMART|SWIGGY ?INSTA", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "SWIGGY", category: "Food:Delivery", priority: 52 },
  { pattern: "ZOMATO|EATCLUB|FAASOS|EATFIT", category: "Food:Delivery", priority: 52 },
  { pattern: "HUNGERBOX|HBOX", category: "Food:Office Canteen", priority: 52 },
  { pattern: "DOMINOS|MCDONALD|KFC|SUBWAY|PIZZAHUT", category: "Food:Restaurant", priority: 54 },
  { pattern: "STARBUCKS|CCD|CAFE|COFFEEDAY|BLUETOKAI", category: "Food:Cafe", priority: 54 },

  // === PERSONAL HABITS (Tea + Cigarettes vendors — user-confirmed) ===
  {
    pattern: "SHILPA[ -]?V|SHILPAV|PAYTM\\.S1J6TMV",
    category: "Personal:Tea & Cigarettes",
    priority: 55,
  },
  {
    pattern: "MSREEPRAKASH|MSREE ?PRAKASH|Q911356614",
    category: "Personal:Tea & Cigarettes",
    priority: 55,
  },

  // === LOCAL VENDORS / GROCERIES ===
  { pattern: "GURUPRASAD", category: "Food:Local Vendor", priority: 60 },
  { pattern: "MRSRUKKAMMA|RUKKAMMA", category: "Food:Local Vendor", priority: 60 },
  { pattern: "SAMANNA|ACHARSIDLI|SRICHANNAKESHAVA", category: "Food:Local Vendor", priority: 60 },
  { pattern: "EMIRATESCHOCOLATES", category: "Food:Local Vendor", priority: 60 },
  {
    pattern: "MOHANSDAILYFRESH|FRESHFRUIT|VEGETABLE|SABZI",
    category: "Food:Groceries",
    priority: 60,
  },
  { pattern: "BALAJIGROCER|JKENTERPRISES|KALIKAMBHAENT", category: "Food:Groceries", priority: 60 },
  { pattern: "DANISH(-|@| )", category: "Food:Local Vendor", priority: 65 },
  { pattern: "KUMAR MANE|KUMARMANE", category: "Food:Local Vendor", priority: 65 },
  { pattern: "MD ?IMRAN|MDIMRAN", category: "Food:Local Vendor", priority: 65 },
  { pattern: "HARSHAD ?P", category: "Food:Local Vendor", priority: 65 },
  { pattern: "JAYASHANKAR", category: "Food:Local Vendor", priority: 65 },
  { pattern: "MANJAPPAM", category: "Food:Local Vendor", priority: 65 },
  { pattern: "KISHOREKS|KISHORE KS", category: "Food:Local Vendor", priority: 65 },
  { pattern: "SUNNY ?KUMAR", category: "Food:Local Vendor", priority: 65 },
  { pattern: "SHAGUFTA", category: "Food:Local Vendor", priority: 65 },
  { pattern: "PAWANKUMAR ?MAHTO", category: "Food:Local Vendor", priority: 65 },

  // === TRANSPORT ===
  { pattern: "(^|-)OLA(-|MONEY)|OLACABS|OLAAUTO", category: "Transport:Cabs", priority: 70 },
  { pattern: "(^|-)UBER(-| )|UBERINDIA", category: "Transport:Cabs", priority: 70 },
  { pattern: "RAPIDO", category: "Transport:Cabs", priority: 70 },
  {
    pattern: "VIJAYGASOLINE|INDIANOIL|HPCL|BPCL|PETROL|FUEL",
    category: "Transport:Fuel",
    priority: 70,
  },
  { pattern: "FASTAG|TOLL|PAYTMFASTAG", category: "Transport:Toll", priority: 70 },
  {
    pattern: "BMRCL|METRORAIL|BMTC|IRCTC|TRAINTKT",
    category: "Transport:Public Transit",
    priority: 70,
  },

  // === SHOPPING ===
  {
    pattern: "APPLE INDIA|APPLE STORE|APPLE.COM|^APPLE\\b",
    category: "Shopping:Apple Electronics",
    priority: 72,
  },
  { pattern: "AMAZON|AMZN", category: "Shopping:Amazon", priority: 72 },
  { pattern: "FLIPKART|MYNTRA|AJIO|MEESHO", category: "Shopping:E-commerce", priority: 72 },
  { pattern: "DECATHLON|NIKE|ADIDAS|PUMA", category: "Shopping:Apparel/Sports", priority: 72 },
  { pattern: "IKEA|URBANLADDER|PEPPERFRY", category: "Shopping:Home", priority: 72 },

  // === HEALTH ===
  {
    pattern: "APOLLO|MEDPLUS|1MG|PHARMEASY|NETMEDS|PHARMACY",
    category: "Health:Pharmacy",
    priority: 74,
  },
  { pattern: "STAR ?DENTAL|DENTAL", category: "Health:Doctor/Hospital", priority: 74 },
  { pattern: "HOSPITAL|CLINIC|^DR\\.|PRACTO", category: "Health:Doctor/Hospital", priority: 74 },
  {
    pattern: "POLICYBAZAAR|HDFCERGO|LICOFIN|INSURANCE|TERMPLAN",
    category: "Health:Insurance",
    priority: 74,
  },

  // === TRAVEL ===
  {
    pattern: "MAKEMYTRIP|MMT|GOIBIBO|YATRA|EASEMYTRIP|CLEARTRIP",
    category: "Travel:Booking",
    priority: 76,
  },
  { pattern: "FLIGHTSMOJO|TRAVELOC", category: "Travel:Booking", priority: 76 },
  { pattern: "INDIGO|VISTARA|AIRINDIA|SPICEJET", category: "Travel:Airline", priority: 76 },
  { pattern: "OYO|HOTELS\\.COM|BOOKING\\.COM|AIRBNB", category: "Travel:Hotel", priority: 76 },

  // === ATM / CASH ===
  { pattern: "ATMWITHDRAWAL|UPIATM|ATMW.D|^ATM-", category: "Cash:ATM Withdrawal", priority: 80 },
  { pattern: "(^|-)ATM(-|@| )", category: "Cash:ATM Withdrawal", priority: 80 },
  {
    pattern: "AMTSHALLBEDEBITED.*ATMCASHWDL|ATMCASH",
    category: "Cash:ATM Withdrawal",
    priority: 80,
  },

  // === CHARGES / TAX ===
  // Word boundaries — \bGST\b doesn't match 'GSTN' (bank's footer text)
  {
    pattern: "\\bTDS\\b|\\bGST\\b|^TAX|INCOMETAX|TAXCHALLAN",
    category: "Charges:Tax",
    priority: 82,
  },
  {
    pattern: "kkarnatakaSBIePay|KARNATAKA.*EPAY|SBIePay|CBDT",
    category: "Charges:Tax",
    priority: 82,
  },
  {
    pattern: "BANKCHARGES|SMSCHARGES|MAINTENANCE|AMC|DEBITCARDAMC",
    category: "Charges:Bank Fees",
    priority: 84,
  },
  // CC-specific charges
  { pattern: "^IGST-|^CGST-|^SGST-", category: "Charges:CC Tax", priority: 86 },
  {
    pattern: "CONSOLIDATED FCY MARKUP|FCY MARKUP",
    category: "Charges:CC FCY Markup",
    priority: 86,
  },
  { pattern: "OFFUS EMI,PROCNG FEE", category: "Charges:CC EMI Fee", priority: 86 },
  { pattern: "AGGREGATOR.*EMI", category: "Transfer:EMI Conversion", priority: 88 },

  // === PERSONAL SERVICES ===
  { pattern: "URBAN ?COMPANY|URBANCLAP", category: "Personal:Services", priority: 90 },
  { pattern: "MERAKI", category: "Personal:Services", priority: 90 }, // YSMERAKI — likely salon

  // === FAMILY / KNOWN PEOPLE ===
  { pattern: "NEHAUPENDRASINGH|NEHA UPENDRA SINGH", category: "Transfer:Family", priority: 92 },
  { pattern: "SARANSHSINHA|SARANSH SINHA", category: "Transfer:Family", priority: 92 },
  { pattern: "POOJARAMSURAT", category: "Transfer:Family", priority: 92 },
  { pattern: "MAHENDRAKUMAR ?SINHA", category: "Transfer:Family", priority: 92 },
  // Shivam — flatmate since Dec 2025; was a friend before. Two UPI handles:
  // SHIVAMWA786@OKSBI, SHIVAMWA321@OKICICI, both via SHIVAMRAMSURAT name
  {
    pattern: "SHIVAMRAMSURAT|SHIVAMWA786|SHIVAMWA321",
    category: "Transfer:Flatmate (Shivam)",
    priority: 92,
  },

  // === FALLBACK: any unmatched UPI to person with common Indian surname ===
  {
    pattern:
      "^UPI-[A-Z]+ ?[A-Z]*(KUMAR|SINGH|SHARMA|VERMA|GUPTA|YADAV|MANE|MAHTO|MEHROTRA|RAO|REDDY|NAIDU|KHAN|HUSSAIN|SINHA|NATH)",
    category: "Transfer:P2P",
    priority: 110,
  },
];
