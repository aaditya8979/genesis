export type TimeframeSec = 5 | 15 | 30 | 60;
export type PriceScaleModeType = "NORMAL" | "LOG" | "PERCENT";

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockTick {
  symbol: string;
  company_name?: string;
  sector?: string;
  pe_ratio?: number;
  price: number;
  anchor_price: number;
  base_price: number;
  change_pct: number;
  tick_delta_pct: number;
  buy_vol_30s: number;
  sell_vol_30s: number;
  buy_pressure_pct: number;
  total_volume: number;
  candle?: CandleBar;
  candles?: CandleBar[];
}

export interface HoldingItem {
  symbol: string;
  position_type: "LONG" | "SHORT";
  quantity: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  pnl_pct: number;
}

export interface Portfolio {
  cash_balance: number;
  collateral_locked: number;
  total_credited: number;
  topup_count: number;
  long_value: number;
  short_liability: number;
  unrealized_pnl: number;
  net_worth: number;
  holdings: HoldingItem[];
}

export interface TransactionItem {
  id: string;
  symbol: string;
  action: "BUY" | "SELL" | "SHORT" | "COVER" | "LIQUIDATE";
  quantity: number;
  execution_price: number;
  total_amount: number;
  realized_pnl: number;
  created_at: string;
}

export interface StudentUser {
  id: string;
  email: string;
  registration_no: string;
  full_name: string;
  is_frozen: boolean;
}

export type ConnectionMode = "CONNECTING" | "LIVE_WSS" | "POLLING_FALLBACK" | "RECONNECTING";
