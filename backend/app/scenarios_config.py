"""Master catalog of 30 stocks and 10 chronological macroeconomic eras for GENESIS 2026."""

from typing import TypedDict


class StockSeed(TypedDict):
    symbol: str
    company_name: str
    sector: str
    base_price: float
    pe_ratio: float
    volatility: float       # Peace-time beta (0.001 defensive -> 0.003 high-beta)
    liquidity_depth: float  # AMM depth in shares (controls organic buy/sell impact)


STOCKS_CATALOG: list[StockSeed] = [
    {"symbol": "OMNA",  "company_name": "Omnia Cloud Systems",       "sector": "Cloud Infrastructure",     "base_price": 320.00, "pe_ratio": 68.0,  "volatility": 0.0028, "liquidity_depth": 4500.0},
    {"symbol": "TMND",  "company_name": "TuringMind AI",             "sector": "AI Compute / LLM",         "base_price": 180.00, "pe_ratio": 115.0, "volatility": 0.0035, "liquidity_depth": 4000.0},
    {"symbol": "KVACH", "company_name": "CyberKavach Infosec",       "sector": "Cybersecurity Defense",    "base_price": 420.00, "pe_ratio": 54.0,  "volatility": 0.0024, "liquidity_depth": 4500.0},
    {"symbol": "VIST",  "company_name": "Vistara Tech Solutions",    "sector": "IT Services & BPO",        "base_price": 850.00, "pe_ratio": 24.5,  "volatility": 0.0016, "liquidity_depth": 5500.0},
    {"symbol": "BCHIP", "company_name": "Bharat Chip Foundry",       "sector": "Semiconductor Fab",        "base_price": 380.00, "pe_ratio": 46.0,  "volatility": 0.0028, "liquidity_depth": 4500.0},
    {"symbol": "APEX",  "company_name": "Apex Capital & Trust",      "sector": "Investment Banking",       "base_price": 540.00, "pe_ratio": 18.2,  "volatility": 0.0025, "liquidity_depth": 4800.0},
    {"symbol": "RVB",   "company_name": "Rashtriya Vikas Bank",      "sector": "Public Sector Bank",       "base_price": 65.00,  "pe_ratio": 6.8,   "volatility": 0.0018, "liquidity_depth": 6500.0},
    {"symbol": "CPBK",  "company_name": "Credence Private Bank",     "sector": "Commercial Private Bank",  "base_price": 720.00, "pe_ratio": 19.5,  "volatility": 0.0020, "liquidity_depth": 5200.0},
    {"symbol": "VNTR",  "company_name": "VentureLeap Finance",       "sector": "Startup & Venture Debt",   "base_price": 190.00, "pe_ratio": 38.0,  "volatility": 0.0030, "liquidity_depth": 4200.0},
    {"symbol": "PAYB",  "company_name": "PayBharat Digital",         "sector": "Payments & FinTech",       "base_price": 95.00,  "pe_ratio": 0.0,   "volatility": 0.0034, "liquidity_depth": 4500.0},
    {"symbol": "PLFE",  "company_name": "PureLife Consumer",         "sector": "FMCG Personal Care",       "base_price": 450.00, "pe_ratio": 48.0,  "volatility": 0.0010, "liquidity_depth": 6000.0},
    {"symbol": "DAIRY", "company_name": "DailyDairy Agro",           "sector": "FMCG Dairy & Food",        "base_price": 180.00, "pe_ratio": 36.0,  "volatility": 0.0010, "liquidity_depth": 6000.0},
    {"symbol": "RBEV",  "company_name": "Royal Beverages Co.",       "sector": "Discretionary Liquor",     "base_price": 820.00, "pe_ratio": 34.0,  "volatility": 0.0018, "liquidity_depth": 5000.0},
    {"symbol": "SANJ",  "company_name": "Sanjeevani Life Sciences",  "sector": "Pharma Generics",          "base_price": 640.00, "pe_ratio": 27.0,  "volatility": 0.0011, "liquidity_depth": 5800.0},
    {"symbol": "GVAX",  "company_name": "GeneVax Therapeutics",      "sector": "Biotech & Vaccines",       "base_price": 290.00, "pe_ratio": 42.0,  "volatility": 0.0029, "liquidity_depth": 4400.0},
    {"symbol": "MCRH",  "company_name": "MediCare Hospitals",        "sector": "Hospital Chains",          "base_price": 980.00, "pe_ratio": 39.0,  "volatility": 0.0015, "liquidity_depth": 5500.0},
    {"symbol": "URJA",  "company_name": "Global Urja Power",         "sector": "Thermal & Grid Utility",   "base_price": 110.00, "pe_ratio": 11.0,  "volatility": 0.0012, "liquidity_depth": 6200.0},
    {"symbol": "PIHC",  "company_name": "PetroInd Hydrocarbons",     "sector": "Oil Refining & Petrochem", "base_price": 340.00, "pe_ratio": 9.5,   "volatility": 0.0023, "liquidity_depth": 5000.0},
    {"symbol": "HSUN",  "company_name": "HelioSun Green Energy",     "sector": "Solar & Wind Utility",     "base_price": 160.00, "pe_ratio": 62.0,  "volatility": 0.0026, "liquidity_depth": 4800.0},
    {"symbol": "VRID",  "company_name": "VoltRide Mobility",         "sector": "EV 2W/4W Mobility",        "base_price": 75.00,  "pe_ratio": 88.0,  "volatility": 0.0033, "liquidity_depth": 4500.0},
    {"symbol": "GATI",  "company_name": "Gati Motors Ltd.",          "sector": "Commercial & Passenger",   "base_price": 480.00, "pe_ratio": 16.0,  "volatility": 0.0020, "liquidity_depth": 5200.0},
    {"symbol": "GARU",  "company_name": "Garuda Airlines",           "sector": "Domestic Aviation",        "base_price": 210.00, "pe_ratio": 28.0,  "volatility": 0.0027, "liquidity_depth": 4600.0},
    {"symbol": "SETU",  "company_name": "Setu Infrastructure",       "sector": "Roads & Civil EPC",        "base_price": 310.00, "pe_ratio": 14.5,  "volatility": 0.0019, "liquidity_depth": 5400.0},
    {"symbol": "SKYL",  "company_name": "Skylark Urban Realty",      "sector": "Real Estate Development",  "base_price": 280.00, "pe_ratio": 31.0,  "volatility": 0.0026, "liquidity_depth": 4800.0},
    {"symbol": "KSTL",  "company_name": "Kalinga Steel & Iron",      "sector": "Primary Steel Mills",      "base_price": 145.00, "pe_ratio": 7.8,   "volatility": 0.0021, "liquidity_depth": 5600.0},
    {"symbol": "BCTC",  "company_name": "Bharat Connect Telecom",    "sector": "5G Network Carrier",       "base_price": 260.00, "pe_ratio": 29.0,  "volatility": 0.0014, "liquidity_depth": 5800.0},
    {"symbol": "STMW",  "company_name": "StreamWave Entertainment",  "sector": "OTT Streaming & Gaming",   "base_price": 195.00, "pe_ratio": 44.0,  "volatility": 0.0027, "liquidity_depth": 4600.0},
    {"symbol": "QDRP",  "company_name": "QuickDrop Logistics",       "sector": "E-Commerce Express Cargo", "base_price": 230.00, "pe_ratio": 33.0,  "volatility": 0.0022, "liquidity_depth": 4900.0},
    {"symbol": "BZAR",  "company_name": "BazaarDirect Retail",       "sector": "Hypermarket Chains",       "base_price": 680.00, "pe_ratio": 35.0,  "volatility": 0.0017, "liquidity_depth": 5200.0},
    {"symbol": "TRSH",  "company_name": "Trishul Defense Systems",   "sector": "Defense Electronics",      "base_price": 520.00, "pe_ratio": 32.0,  "volatility": 0.0015, "liquidity_depth": 5500.0},
]


class EraScenario(TypedDict):
    id: str
    order: int
    name: str
    headline: str
    description: str
    severity: str  # CRASH | BOOM | VOLATILE
    deltas: dict[str, float]


SCENARIOS_MAP: dict[str, EraScenario] = {
    "ERA_1_DOT_COM": {
        "id": "ERA_1_DOT_COM",
        "order": 1,
        "name": "Era 1: Dot-Com Implosion (2000)",
        "headline": "DOT-COM CRASH: Unprofitable tech vaporware collapses; FMCG & Pharma absorb safe-haven capital!",
        "description": "Tech multiples crash as vaporware revenue is uncovered; FMCG safe-haven rotation.",
        "severity": "CRASH",
        "deltas": {
            "TMND": -0.65, "PAYB": -0.62, "OMNA": -0.55, "VRID": -0.48, "BCHIP": -0.45,
            "KVACH": -0.40, "STMW": -0.38, "VNTR": -0.42, "VIST": -0.30, "BCTC": -0.25,
            "QDRP": -0.24, "HSUN": -0.22, "APEX": -0.22, "SKYL": -0.20, "CPBK": -0.18,
            "GATI": -0.18, "GARU": -0.16, "SETU": -0.15, "KSTL": -0.14, "BZAR": -0.12,
            "PIHC": -0.10, "RVB": -0.10, "RBEV": -0.08, "URJA": -0.06, "PLFE": +0.08,
            "DAIRY": +0.10, "SANJ": +0.12, "GVAX": +0.05, "MCRH": +0.07, "TRSH": +0.04,
        },
    },
    "ERA_2_CAPEX": {
        "id": "ERA_2_CAPEX",
        "order": 2,
        "name": "Era 2: Infrastructure Capex Supercycle (2004–2007)",
        "headline": "CAPEX BOOM: Sovereign highway & steel buildout sparks historic rally in Industrials and PSU Banks!",
        "description": "Massive infrastructure expansion drives Steel, EPC roads, and PSU banking growth.",
        "severity": "BOOM",
        "deltas": {
            "KSTL": +0.55, "SETU": +0.48, "RVB": +0.36, "GATI": +0.34, "URJA": +0.30,
            "PIHC": +0.28, "SKYL": +0.32, "APEX": +0.26, "CPBK": +0.24, "TRSH": +0.22,
            "BCTC": +0.20, "VIST": +0.18, "BZAR": +0.16, "QDRP": +0.18, "GARU": +0.15,
            "RBEV": +0.14, "HSUN": +0.12, "MCRH": +0.10, "OMNA": +0.12, "BCHIP": +0.14,
            "KVACH": +0.10, "SANJ": +0.06, "PLFE": +0.05, "DAIRY": +0.05, "VNTR": +0.12,
            "PAYB": +0.08, "VRID": +0.06, "STMW": +0.09, "GVAX": +0.04, "TMND": +0.05,
        },
    },
    "ERA_3_GFC_2008": {
        "id": "ERA_3_GFC_2008",
        "order": 3,
        "name": "Era 3: Global Financial Crisis (2008)",
        "headline": "LEHMAN SHOCK: Credit freeze hits private lenders and leveraged real estate; sovereign utilities hold!",
        "description": "Global banking panic crushes venture debt, realty, and investment banking.",
        "severity": "CRASH",
        "deltas": {
            "VNTR": -0.68, "SKYL": -0.58, "APEX": -0.52, "GARU": -0.45, "CPBK": -0.38,
            "GATI": -0.35, "KSTL": -0.32, "PAYB": -0.36, "VRID": -0.34, "SETU": -0.28,
            "PIHC": -0.26, "OMNA": -0.24, "TMND": -0.22, "BCHIP": -0.24, "STMW": -0.20,
            "BZAR": -0.18, "QDRP": -0.20, "VIST": -0.16, "KVACH": -0.15, "HSUN": -0.18,
            "RBEV": -0.14, "BCTC": -0.10, "RVB": -0.12, "GVAX": -0.08, "URJA": -0.05,
            "MCRH": -0.04, "PLFE": +0.04, "DAIRY": +0.06, "SANJ": +0.08, "TRSH": +0.02,
        },
    },
    "ERA_4_QE_STIMULUS": {
        "id": "ERA_4_QE_STIMULUS",
        "order": 4,
        "name": "Era 4: Global QE Stimulus & Liquidity Flood (2010–2013)",
        "headline": "QE STIMULUS: Central banks print cheap liquidity; Private Banks, Autos, and Discretionary Consumption surge!",
        "description": "Low interest rates fuel credit growth, auto sales, retail, and IT outsourcing.",
        "severity": "BOOM",
        "deltas": {
            "CPBK": +0.38, "GATI": +0.35, "BZAR": +0.30, "RBEV": +0.28, "VIST": +0.26,
            "APEX": +0.25, "SKYL": +0.24, "MCRH": +0.22, "BCTC": +0.20, "QDRP": +0.22,
            "KVACH": +0.18, "OMNA": +0.20, "STMW": +0.21, "PLFE": +0.16, "DAIRY": +0.14,
            "SANJ": +0.15, "GVAX": +0.16, "VNTR": +0.24, "PAYB": +0.22, "GARU": +0.18,
            "SETU": +0.14, "KSTL": +0.12, "BCHIP": +0.15, "TRSH": +0.12, "RVB": +0.14,
            "URJA": +0.10, "PIHC": +0.08, "HSUN": +0.14, "VRID": +0.15, "TMND": +0.18,
        },
    },
    "ERA_5_CRUDE_CRASH": {
        "id": "ERA_5_CRUDE_CRASH",
        "order": 5,
        "name": "Era 5: Crude Oil Price Collapse (2014–2016)",
        "headline": "OIL COLLAPSE: Brent plunges below $30! Airlines and Paints soar while Petrochemicals tumble!",
        "description": "Commodity slump slashes aviation fuel costs while crushing oil refiners.",
        "severity": "VOLATILE",
        "deltas": {
            "GARU": +0.42, "GATI": +0.28, "QDRP": +0.26, "PLFE": +0.20, "BZAR": +0.18,
            "RBEV": +0.16, "DAIRY": +0.15, "CPBK": +0.16, "VIST": +0.14, "BCTC": +0.12,
            "SETU": +0.15, "MCRH": +0.10, "SANJ": +0.10, "STMW": +0.12, "OMNA": +0.12,
            "KVACH": +0.10, "TRSH": +0.08, "GVAX": +0.06, "TMND": +0.10, "PAYB": +0.12,
            "BCHIP": +0.08, "RVB": +0.06, "SKYL": +0.04, "VRID": -0.10, "HSUN": -0.14,
            "URJA": +0.05, "VNTR": -0.05, "APEX": +0.08, "KSTL": -0.18, "PIHC": -0.45,
        },
    },
    "ERA_6_DIGITAL_EV": {
        "id": "ERA_6_DIGITAL_EV",
        "order": 6,
        "name": "Era 6: Digital Payments & EV Wave (2017–2019)",
        "headline": "DIGITAL INDIA WAVE: Cashless UPI boom and EV subsidies trigger breakout across FinTech & CleanTech!",
        "description": "Hyper-adoption of digital payments, 4G/5G telecom, OTT, and EV mobility.",
        "severity": "BOOM",
        "deltas": {
            "VRID": +0.65, "PAYB": +0.55, "STMW": +0.40, "BCTC": +0.36, "HSUN": +0.34,
            "OMNA": +0.32, "QDRP": +0.28, "KVACH": +0.26, "TMND": +0.25, "VNTR": +0.24,
            "BCHIP": +0.22, "BZAR": +0.16, "CPBK": +0.15, "APEX": +0.14, "VIST": +0.14,
            "MCRH": +0.10, "SANJ": +0.08, "GVAX": +0.10, "PLFE": +0.08, "DAIRY": +0.07,
            "RBEV": +0.09, "TRSH": +0.12, "SETU": +0.08, "SKYL": +0.05, "KSTL": +0.04,
            "RVB": +0.04, "GARU": +0.05, "GATI": -0.06, "URJA": -0.08, "PIHC": -0.10,
        },
    },
    "ERA_7_COVID_19": {
        "id": "ERA_7_COVID_19",
        "order": 7,
        "name": "Era 7: COVID-19 Global Lockdowns (2020)",
        "headline": "LOCKDOWN SHOCK: Flights grounded, retail shuttered! Biotech, Pharma, Cloud, and OTT skyrocket!",
        "description": "Physical mobility halts completely; healthcare and remote cloud infrastructure spike.",
        "severity": "CRASH",
        "deltas": {
            "GVAX": +0.68, "MCRH": +0.46, "SANJ": +0.42, "OMNA": +0.38, "STMW": +0.36,
            "KVACH": +0.30, "BCTC": +0.26, "QDRP": +0.24, "DAIRY": +0.18, "PLFE": +0.16,
            "VIST": +0.18, "TMND": +0.20, "PAYB": +0.14, "BCHIP": +0.15, "TRSH": +0.05,
            "URJA": -0.06, "HSUN": -0.10, "CPBK": -0.22, "RVB": -0.20, "VNTR": -0.28,
            "APEX": -0.24, "KSTL": -0.26, "SETU": -0.28, "PIHC": -0.32, "VRID": -0.30,
            "GATI": -0.36, "SKYL": -0.40, "RBEV": -0.44, "BZAR": -0.48, "GARU": -0.62,
        },
    },
    "ERA_8_SUPPLY_BOTTLENECKS": {
        "id": "ERA_8_SUPPLY_BOTTLENECKS",
        "order": 8,
        "name": "Era 8: Post-COVID Supply Squeeze & Inflation (2021–2022)",
        "headline": "CHIP & COMMODITY SQUEEZE: Global silicon shortage sends Semis, Steel, Defense, and Energy surging!",
        "description": "Reopening inflation spikes commodities, semiconductors, defense electronics, and power.",
        "severity": "VOLATILE",
        "deltas": {
            "BCHIP": +0.52, "KSTL": +0.44, "PIHC": +0.38, "TRSH": +0.36, "URJA": +0.30,
            "SETU": +0.28, "BZAR": +0.24, "RBEV": +0.22, "GARU": +0.25, "GATI": +0.20,
            "SKYL": +0.18, "RVB": +0.22, "CPBK": +0.14, "QDRP": +0.16, "HSUN": +0.18,
            "PLFE": +0.06, "DAIRY": +0.06, "SANJ": +0.04, "MCRH": +0.08, "BCTC": +0.10,
            "APEX": +0.08, "KVACH": +0.12, "VIST": +0.05, "OMNA": -0.06, "TMND": -0.08,
            "VRID": -0.10, "GVAX": -0.12, "VNTR": -0.16, "STMW": -0.18, "PAYB": -0.22,
        },
    },
    "ERA_9_AI_SUPERCYCLE": {
        "id": "ERA_9_AI_SUPERCYCLE",
        "order": 9,
        "name": "Era 9: Generative AI Infrastructure Supercycle (2023–2025)",
        "headline": "AI SUPERCYCLE: Sovereign GPU clusters & LLM mania send Compute, Cloud, and Power parabolic!",
        "description": "Trillions pour into AI compute, silicon foundries, cloud scaling, and grid power.",
        "severity": "BOOM",
        "deltas": {
            "TMND": +0.85, "BCHIP": +0.48, "OMNA": +0.44, "KVACH": +0.38, "URJA": +0.32,
            "HSUN": +0.28, "TRSH": +0.26, "VIST": +0.20, "BCTC": +0.18, "PAYB": +0.22,
            "VRID": +0.24, "VNTR": +0.20, "APEX": +0.18, "CPBK": +0.16, "QDRP": +0.16,
            "SETU": +0.15, "SKYL": +0.14, "KSTL": +0.12, "GATI": +0.12, "MCRH": +0.10,
            "GVAX": +0.15, "STMW": +0.14, "BZAR": +0.08, "RBEV": +0.06, "RVB": +0.10,
            "GARU": +0.08, "PLFE": +0.04, "DAIRY": +0.04, "SANJ": +0.05, "PIHC": +0.02,
        },
    },
    "ERA_10_YAPOO_59": {
        "id": "ERA_10_YAPOO_59",
        "order": 10,
        "name": "Era 10: YAPOO 59 – The Blackout Protocol",
        "headline": "UNIVERSAL CATACLYSM: YAPOO 59 solar EMP & cyber blackout triggers unprecedented global market collapse!",
        "description": "UNIVERSAL DEADLY APOCALYPSE: Solar EMP and cyber-biological strike collapse all rails.",
        "severity": "CRASH",
        "deltas": {
            "TMND": -0.85, "PAYB": -0.80, "VRID": -0.78, "OMNA": -0.75, "STMW": -0.72,
            "KVACH": -0.70, "VNTR": -0.68, "HSUN": -0.68, "GARU": -0.65, "BCHIP": -0.65,
            "SKYL": -0.62, "QDRP": -0.60, "APEX": -0.58, "CPBK": -0.55, "VIST": -0.54,
            "GATI": -0.52, "KSTL": -0.50, "BCTC": -0.50, "GVAX": -0.49,
            "SETU": -0.48, "PIHC": -0.45, "BZAR": -0.42, "RBEV": -0.38, "URJA": -0.35,
            "MCRH": -0.30, "SANJ": -0.25, "PLFE": -0.24, "DAIRY": -0.22, "RVB": -0.18,
            "TRSH": -0.18,
        },
    },
}
