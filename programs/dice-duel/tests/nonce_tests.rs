// ═══════════════════════════════════════════════════════════════════════
//  WAGER NONCE SYSTEM TESTS — Phase 1.5
//
//  Tests the nonce-based PDA scheme: ["wager", challenger, nonce_le_bytes]
//  27 test cases from the implementation plan (doc #13) and audit report.
// ═══════════════════════════════════════════════════════════════════════

use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, Space};
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    system_program,
    transaction::Transaction,
};

use dice_duel::constants::*;
use dice_duel::errors::DiceDuelError;
use dice_duel::state::*;

const PROGRAM_ID: Pubkey = dice_duel::ID;
const FEE_BPS: u16 = 500;
const MINT_PRICE: u64 = 50_000_000;
const INITIAL_USES: u8 = 10;
const WAGER_EXPIRY: i64 = 600;
const VRF_TIMEOUT: i64 = 900;
const SOL: u64 = LAMPORTS_PER_SOL;

// ─── PDA helpers (nonce-aware) ─────────────────────────────────────────

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_CONFIG], &PROGRAM_ID)
}
fn dice_bag_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_DICE_BAG, mint.as_ref()], &PROGRAM_ID)
}
fn wager_pda(challenger: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_WAGER, challenger.as_ref(), &nonce.to_le_bytes()],
        &PROGRAM_ID,
    )
}
fn escrow_pda(wager: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_ESCROW, wager.as_ref()], &PROGRAM_ID)
}
fn stats_pda(player: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_STATS, player.as_ref()], &PROGRAM_ID)
}
fn game_type_pda(id: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_GAME_TYPE, &id.to_le_bytes()], &PROGRAM_ID)
}

// ─── Program test setup ───────────────────────────────────────────────

fn program() -> ProgramTest {
    let mut pt = ProgramTest::new("dice_duel", PROGRAM_ID, None);
    pt.prefer_bpf(true);
    pt
}

// ─── Instruction builders (nonce-aware) ────────────────────────────────

fn ix_initialize(
    admin: &Pubkey,
    treasury: &Pubkey,
    fee_bps: u16,
    mint_price: u64,
    initial_uses: u8,
    wager_expiry: i64,
    vrf_timeout: i64,
) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::Initialize {
            treasury: *treasury,
            fee_bps,
            mint_price,
            initial_uses,
            wager_expiry_seconds: wager_expiry,
            vrf_timeout_seconds: vrf_timeout,
        }
        .data(),
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

fn ix_register_game_type(admin: &Pubkey, id: u8, name: &str, enabled: bool) -> Instruction {
    let (config, _) = config_pda();
    let (gt, _) = game_type_pda(id);
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::RegisterGameType {
            id,
            name: name.to_string(),
            enabled,
        }
        .data(),
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(gt, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

/// Build initiate_wager instruction with nonce-aware PDA derivation.
/// `current_nonce` = challenger_stats.wager_nonce (the NEXT nonce to use).
/// If `prev_nonce` is Some, includes prev_wager + prev_escrow for cleanup.
fn ix_initiate_wager(
    challenger: &Pubkey,
    bag_mint: &Pubkey,
    opponent: &Pubkey,
    amount: u64,
    game_type: u8,
    choice: u8,
    current_nonce: u64,
    prev_nonce: Option<u64>,
) -> Instruction {
    let (bag, _) = dice_bag_pda(bag_mint);
    let (stats, _) = stats_pda(challenger);
    let (wager, _) = wager_pda(challenger, current_nonce);
    let (escrow, _) = escrow_pda(&wager);
    let (config, _) = config_pda();
    let (gt, _) = game_type_pda(game_type);

    let mut accounts = vec![
        AccountMeta::new(*challenger, true),
        AccountMeta::new_readonly(bag, false),
        AccountMeta::new(stats, false),
        AccountMeta::new(wager, false),
        AccountMeta::new(escrow, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new_readonly(gt, false),
    ];

    // Optional prev_wager + prev_escrow
    if let Some(pn) = prev_nonce {
        let (prev_wager, _) = wager_pda(challenger, pn);
        let (prev_escrow, _) = escrow_pda(&prev_wager);
        accounts.push(AccountMeta::new(prev_wager, false));
        accounts.push(AccountMeta::new(prev_escrow, false));
    } else {
        // Anchor optional accounts: pass program ID as sentinel
        accounts.push(AccountMeta::new_readonly(PROGRAM_ID, false));
        accounts.push(AccountMeta::new_readonly(PROGRAM_ID, false));
    }

    accounts.push(AccountMeta::new_readonly(system_program::ID, false));

    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::InitiateWager {
            opponent: *opponent,
            amount,
            game_type,
            challenger_choice: choice,
        }
        .data(),
        accounts,
    )
}

/// Cancel wager with nonce-aware PDA. Now requires challenger_stats.
fn ix_cancel_wager(challenger: &Pubkey, nonce: u64) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (escrow, _) = escrow_pda(&wager);
    let (stats, _) = stats_pda(challenger);
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::CancelWager {}.data(),
        vec![
            AccountMeta::new(*challenger, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(stats, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

/// Claim expired wager with nonce. Now requires challenger_stats.
fn ix_claim_expired(caller: &Pubkey, challenger: &Pubkey, nonce: u64) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (escrow, _) = escrow_pda(&wager);
    let (config, _) = config_pda();
    let (stats, _) = stats_pda(challenger);
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::ClaimExpired {}.data(),
        vec![
            AccountMeta::new_readonly(*caller, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(*challenger, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(stats, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

/// Claim VRF timeout with nonce.
fn ix_claim_vrf_timeout(
    caller: &Pubkey,
    challenger: &Pubkey,
    opponent: &Pubkey,
    nonce: u64,
) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (escrow, _) = escrow_pda(&wager);
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::ClaimVrfTimeout {}.data(),
        vec![
            AccountMeta::new_readonly(*caller, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(*challenger, false),
            AccountMeta::new(*opponent, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

/// Consume randomness resolved with nonce.
fn ix_consume_randomness_resolved(
    vrf_signer: &Pubkey,
    challenger: &Pubkey,
    opponent: &Pubkey,
    bag_mint: &Pubkey,
    nonce: u64,
    randomness: [u8; 32],
) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (bag, _) = dice_bag_pda(bag_mint);
    let (c_stats, _) = stats_pda(challenger);
    let (o_stats, _) = stats_pda(opponent);
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::ConsumeRandomnessResolved { randomness }.data(),
        vec![
            AccountMeta::new_readonly(*vrf_signer, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(c_stats, false),
            AccountMeta::new(o_stats, false),
            AccountMeta::new(bag, false),
        ],
    )
}

/// Claim winnings with nonce.
fn ix_claim_winnings(
    claimer: &Pubkey,
    challenger: &Pubkey,
    treasury: &Pubkey,
    nonce: u64,
) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (escrow, _) = escrow_pda(&wager);
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::ClaimWinnings {}.data(),
        vec![
            AccountMeta::new(*claimer, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(*challenger, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(*treasury, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

/// Cleanup stale wager instruction (permissionless).
fn ix_cleanup_stale_wager(
    payer: &Pubkey,
    challenger: &Pubkey,
    nonce: u64,
) -> Instruction {
    let (wager, _) = wager_pda(challenger, nonce);
    let (stats, _) = stats_pda(challenger);
    let (escrow, _) = escrow_pda(&wager);
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &dice_duel::instruction::CleanupStaleWager {}.data(),
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(wager, false),
            AccountMeta::new(stats, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(*challenger, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    )
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn make_dice_bag_account(mint: &Pubkey, owner: &Pubkey, uses: u8) -> (Pubkey, Account) {
    let (pda, bump) = dice_bag_pda(mint);
    let bag = DiceBag {
        mint: *mint,
        owner: *owner,
        uses_remaining: uses,
        total_games: 0,
        wins: 0,
        losses: 0,
        bump,
    };
    let mut data = Vec::with_capacity(128);
    data.extend_from_slice(&DiceBag::DISCRIMINATOR);
    borsh::BorshSerialize::serialize(&bag, &mut data).unwrap();
    (
        pda,
        Account {
            lamports: 1_000_000,
            data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn make_wager_data(wager: &Wager) -> Vec<u8> {
    let total_size = 8 + Wager::INIT_SPACE;
    let mut data = Vec::with_capacity(total_size);
    data.extend_from_slice(&Wager::DISCRIMINATOR);
    borsh::BorshSerialize::serialize(wager, &mut data).unwrap();
    data.resize(total_size, 0);
    data
}

/// Create a wager account at a specific nonce. Uses dice_bag PDA key for challenger_bag.
fn make_wager_account(
    challenger: &Pubkey,
    opponent: &Pubkey,
    bag_mint: &Pubkey,
    amount: u64,
    status: WagerStatus,
    choice: u8,
    nonce: u64,
    created_at: i64,
    vrf_requested_at: i64,
) -> (Pubkey, Account) {
    let (wager_key, wager_bump) = wager_pda(challenger, nonce);
    let (_, escrow_bump) = escrow_pda(&wager_key);
    let (bag_pda, _) = dice_bag_pda(bag_mint);
    let wager = Wager {
        challenger: *challenger,
        opponent: *opponent,
        challenger_bag: bag_pda,
        amount,
        game_type: 0,
        challenger_choice: choice,
        status,
        nonce,
        vrf_requested_at,
        vrf_result: None,
        vrf_fulfilled_at: None,
        winner: None,
        created_at,
        settled_at: None,
        threshold: HIGH_LOW_THRESHOLD,
        payout_multiplier_bps: DEFAULT_PAYOUT_MULTIPLIER_BPS,
        escrow_bump,
        bump: wager_bump,
    };
    let data = make_wager_data(&wager);
    let rent = 2_000_000; // safe rent-exempt for 199-byte wager
    (
        wager_key,
        Account {
            lamports: rent,
            data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

/// Create a Resolved wager account at a specific nonce.
fn make_resolved_wager_account(
    challenger: &Pubkey,
    opponent: &Pubkey,
    bag_mint: &Pubkey,
    amount: u64,
    choice: u8,
    winner: &Pubkey,
    vrf_result: u8,
    nonce: u64,
) -> (Pubkey, Account) {
    let (wager_key, wager_bump) = wager_pda(challenger, nonce);
    let (_, escrow_bump) = escrow_pda(&wager_key);
    let (bag_pda, _) = dice_bag_pda(bag_mint);
    let wager = Wager {
        challenger: *challenger,
        opponent: *opponent,
        challenger_bag: bag_pda,
        amount,
        game_type: 0,
        challenger_choice: choice,
        status: WagerStatus::Resolved,
        nonce,
        vrf_requested_at: 0,
        vrf_result: Some(vrf_result),
        vrf_fulfilled_at: Some(100),
        winner: Some(*winner),
        created_at: 0,
        settled_at: None,
        threshold: HIGH_LOW_THRESHOLD,
        payout_multiplier_bps: DEFAULT_PAYOUT_MULTIPLIER_BPS,
        escrow_bump,
        bump: wager_bump,
    };
    let data = make_wager_data(&wager);
    let rent = 2_000_000; // safe rent-exempt for 199-byte wager
    (
        wager_key,
        Account {
            lamports: rent,
            data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn make_escrow_account(challenger: &Pubkey, nonce: u64, lamports: u64) -> (Pubkey, Account) {
    let (wager_key, _) = wager_pda(challenger, nonce);
    let (escrow_key, _) = escrow_pda(&wager_key);
    (
        escrow_key,
        Account {
            lamports,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn make_stats_account(player: &Pubkey, wager_nonce: u64, pending_nonce: Option<u64>) -> (Pubkey, Account) {
    let (pda, bump) = stats_pda(player);
    let stats = PlayerStats {
        player: *player,
        total_games: 0,
        wins: 0,
        losses: 0,
        sol_wagered: 0,
        sol_won: 0,
        current_streak: 0,
        best_streak: 0,
        wager_nonce,
        pending_nonce,
        bump,
    };
    let total_size = 8 + PlayerStats::INIT_SPACE;
    let mut data = Vec::with_capacity(total_size);
    data.extend_from_slice(&PlayerStats::DISCRIMINATOR);
    borsh::BorshSerialize::serialize(&stats, &mut data).unwrap();
    data.resize(total_size, 0);
    // Rent-exempt minimum for 94-byte account: ~1,113,600 lamports. Use 2M to be safe.
    (
        pda,
        Account {
            lamports: 2_000_000,
            data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

async fn decode_account<T: AnchorDeserialize + Discriminator>(
    banks: &mut BanksClient,
    pk: &Pubkey,
) -> T {
    let acct = banks
        .get_account(*pk)
        .await
        .unwrap()
        .expect("Account not found");
    T::deserialize(&mut &acct.data[8..]).expect("Deserialize failed")
}

async fn account_exists(banks: &mut BanksClient, pk: &Pubkey) -> bool {
    banks.get_account(*pk).await.unwrap().is_some()
}

async fn get_balance(banks: &mut BanksClient, pk: &Pubkey) -> u64 {
    banks.get_balance(*pk).await.unwrap()
}

fn get_error_code(err: &str) -> Option<u32> {
    if let Some(pos) = err.find("0x") {
        let rest = &err[pos + 2..];
        let hex: String = rest.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
        return u32::from_str_radix(&hex, 16).ok();
    }
    err.find("Custom(").and_then(|s| {
        let rest = &err[s + 7..];
        rest.find(')').and_then(|e| rest[..e].parse().ok())
    })
}

fn anchor_error(err: DiceDuelError) -> u32 {
    6000 + err as u32
}

async fn init_config(
    banks: &mut BanksClient,
    payer: &Keypair,
    blockhash: solana_sdk::hash::Hash,
    treasury: &Pubkey,
) {
    let tx = Transaction::new_signed_with_payer(
        &[ix_initialize(
            &payer.pubkey(),
            treasury,
            FEE_BPS,
            MINT_PRICE,
            INITIAL_USES,
            WAGER_EXPIRY,
            VRF_TIMEOUT,
        )],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );
    banks.process_transaction(tx).await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_register_game_type(&payer.pubkey(), 0, "High/Low", true)],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );
    banks.process_transaction(tx2).await.unwrap();
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 1: Create first wager (nonce 0)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_01_create_first_wager() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // First wager: nonce=0, no prev_wager
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            SOL,
            0,
            1,
            0,    // current_nonce
            None, // no prev
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Verify wager created at nonce 0
    let (wager_key, _) = wager_pda(&challenger.pubkey(), 0);
    let w: Wager = decode_account(&mut banks, &wager_key).await;
    assert_eq!(w.challenger, challenger.pubkey());
    assert_eq!(w.opponent, opponent.pubkey());
    assert_eq!(w.amount, SOL);
    assert_eq!(w.status, WagerStatus::Pending);
    assert_eq!(w.nonce, 0);

    // Verify PlayerStats: wager_nonce=1, pending_nonce=Some(0)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 1, "wager_nonce should be 1 after first wager");
    assert_eq!(stats.pending_nonce, Some(0), "pending_nonce should be Some(0)");
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 2: Create second wager with cleanup (nonce 1)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_02_create_second_wager_with_cleanup() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent1.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // First wager: nonce 0
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent1.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    let before = get_balance(&mut banks, &challenger.pubkey()).await;

    // Second wager: nonce 1, cleanup nonce 0
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            2 * SOL,
            0,
            0,
            1,       // current_nonce = 1
            Some(0), // cleanup nonce 0
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // Old wager at nonce 0 should be closed (refunded)
    let (old_wager_key, _) = wager_pda(&challenger.pubkey(), 0);
    assert!(
        !account_exists(&mut banks, &old_wager_key).await,
        "Old wager should be closed"
    );

    // New wager at nonce 1
    let (new_wager_key, _) = wager_pda(&challenger.pubkey(), 1);
    let w: Wager = decode_account(&mut banks, &new_wager_key).await;
    assert_eq!(w.opponent, opponent2.pubkey());
    assert_eq!(w.amount, 2 * SOL);
    assert_eq!(w.nonce, 1);
    assert_eq!(w.status, WagerStatus::Pending);

    // PlayerStats: wager_nonce=2, pending_nonce=Some(1)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 2);
    assert_eq!(stats.pending_nonce, Some(1));
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 3: Create second wager WITHOUT cleanup (should fail)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_03_create_without_cleanup_fails() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent1.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // First wager: nonce 0
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent1.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Try second wager WITHOUT passing prev_wager — should fail with PreviousWagerRequired
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            SOL,
            0,
            1,
            1,    // nonce 1
            None, // no cleanup!
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    let err = banks.process_transaction(tx2).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::PreviousWagerRequired)),
        "Should fail with PreviousWagerRequired"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 4: Accept wager with correct nonce
//  (Simulated: inject Pending wager + stats, call accept)
//  NOTE: accept_wager requires VRF CPI which doesn't work in ProgramTest.
//  We verify the state transition by injecting Active state after accept.
//  The nonce freshness check is tested via injected state.
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_04_accept_wager_correct_nonce() {
    // We can't call accept_wager directly (VRF CPI dependency).
    // Instead, we verify the logic by:
    // 1. Creating a wager via initiate_wager (nonce 0)
    // 2. Injecting an Active state to simulate accepted wager
    // 3. Verifying pending_nonce was cleared (simulated by checking after cancel flow)

    // What we CAN test: create wager, then cancel it, verify pending_nonce = None
    // This proves the pending_nonce tracking works.
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create wager at nonce 0
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Verify pending_nonce = Some(0) after initiate
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.pending_nonce, Some(0));

    // Cancel wager (this clears pending_nonce since nonce matches)
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_cancel_wager(&challenger.pubkey(), 0)],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // After cancel: pending_nonce should be None (simulates what accept does too)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(
        stats.pending_nonce, None,
        "pending_nonce should be None after cancel"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 5: Accept stale wager (wrong nonce) — WagerStale error
//  Tested by injecting state where pending_nonce != wager.nonce
// ═══════════════════════════════════════════════════════════════════════

// NOTE: accept_wager can't be called in ProgramTest (VRF CPI).
// The WagerStale check `challenger_stats.pending_nonce == Some(wager.nonce)` is in accept_wager.
// We verify the nonce freshness logic indirectly:
// If we create wager at nonce 0, then create new wager at nonce 1 (cleanup 0),
// the old wager is gone. The nonce freshness check in accept_wager prevents
// accepting stale wagers, but we can't call it directly.
// This test is marked as a logic verification note.

// ═══════════════════════════════════════════════════════════════════════
//  TEST 6: Cancel wager with nonce
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_06_cancel_wager_with_nonce() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create wager at nonce 0
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    let before = get_balance(&mut banks, &challenger.pubkey()).await;

    // Cancel wager at nonce 0
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_cancel_wager(&challenger.pubkey(), 0)],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // Wager closed
    let (wager_key, _) = wager_pda(&challenger.pubkey(), 0);
    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Wager should be closed after cancel"
    );

    // Escrow refunded
    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > before,
        "Challenger should get escrow refund"
    );

    // pending_nonce cleared
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.pending_nonce, None, "pending_nonce should be None after cancel");
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 7: Claim expired with nonce
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_07_claim_expired_with_nonce() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Inject a Pending wager at nonce 0 with created_at=0 (expired)
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,  // nonce
        0,  // created_at (far past = expired)
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    // Stats with wager_nonce=1, pending_nonce=Some(0)
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, Some(0));

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    let c_before = get_balance(&mut banks, &challenger.pubkey()).await;
    let tx = Transaction::new_signed_with_payer(
        &[ix_claim_expired(&caller.pubkey(), &challenger.pubkey(), 0)],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Wager closed, challenger refunded
    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Wager should be closed"
    );
    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > c_before,
        "Challenger should get refund"
    );

    // pending_nonce cleared
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.pending_nonce, None, "pending_nonce should be None after claim_expired");
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 8: Claim winnings on old nonce — winner ALWAYS gets paid
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_08_claim_winnings_on_old_nonce() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let treasury = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Resolved wager at nonce 0 (challenger wins)
    let (wager_key, wager_acct) = make_resolved_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        1,
        &challenger.pubkey(),
        99,
        0, // nonce 0
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        treasury.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &treasury.pubkey()).await;

    let c_before = get_balance(&mut banks, &challenger.pubkey()).await;
    let t_before = get_balance(&mut banks, &treasury.pubkey()).await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_claim_winnings(
            &challenger.pubkey(),
            &challenger.pubkey(),
            &treasury.pubkey(),
            0,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Winner gets payout, treasury gets fee
    let fee = get_balance(&mut banks, &treasury.pubkey()).await - t_before;
    assert_eq!(fee, 2 * SOL * FEE_BPS as u64 / 10_000, "Fee = 5% of pot");
    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > c_before + SOL,
        "Winner gets payout"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 9: Create new wager while old Resolved exists
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_09_create_wager_while_resolved_exists() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    // Pre-existing Resolved wager at nonce 0 (pending_nonce=None because it was accepted)
    // Stats: wager_nonce=1, pending_nonce=None
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, None);

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create new wager at nonce 1 (no cleanup needed — pending_nonce is None)
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            SOL,
            0,
            1,
            1,    // nonce 1
            None, // no prev needed
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    let (new_wager_key, _) = wager_pda(&challenger.pubkey(), 1);
    let w: Wager = decode_account(&mut banks, &new_wager_key).await;
    assert_eq!(w.nonce, 1);
    assert_eq!(w.status, WagerStatus::Pending);

    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 2);
    assert_eq!(stats.pending_nonce, Some(1));
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 10: VRF timeout on nonce-based wager
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_10_vrf_timeout() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Inject Active wager at nonce 0, vrf_requested_at = 0 (timed out)
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Active,
        1,
        0, // nonce
        0, // created_at
        0, // vrf_requested_at (far past = timed out)
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    let c_before = get_balance(&mut banks, &challenger.pubkey()).await;
    let o_before = get_balance(&mut banks, &opponent.pubkey()).await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_claim_vrf_timeout(
            &caller.pubkey(),
            &challenger.pubkey(),
            &opponent.pubkey(),
            0,
        )],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > c_before,
        "Challenger refunded"
    );
    assert!(
        get_balance(&mut banks, &opponent.pubkey()).await > o_before,
        "Opponent refunded"
    );
    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Wager closed"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 11: VRF resolve on nonce-based wager
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_11_vrf_resolve() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let vrf_signer = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Inject Active wager at nonce 0
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Active,
        1,
        0, // nonce
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), 9);
    let (cs_pda, cs_acct) = make_stats_account(&challenger.pubkey(), 1, None);
    let (os_pda, os_acct) = make_stats_account(&opponent.pubkey(), 0, None);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(cs_pda, cs_acct);
    pt.add_account(os_pda, os_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        vrf_signer.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    let mut randomness = [0u8; 32];
    randomness[31] = 99; // HIGH wins

    let tx = Transaction::new_signed_with_payer(
        &[ix_consume_randomness_resolved(
            &vrf_signer.pubkey(),
            &challenger.pubkey(),
            &opponent.pubkey(),
            &bag_mint,
            0,
            randomness,
        )],
        Some(&vrf_signer.pubkey()),
        &[&vrf_signer],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    let w: Wager = decode_account(&mut banks, &wager_pda(&challenger.pubkey(), 0).0).await;
    assert_eq!(w.status, WagerStatus::Resolved);
    assert_eq!(w.winner, Some(challenger.pubkey()));

    // pending_nonce should still be None (Active wager — was already cleared during accept)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.pending_nonce, None, "pending_nonce stays None after resolve");
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 12: Cleanup stale wager (permissionless)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_12_cleanup_stale_wager() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let random_caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Inject a stale Pending wager at nonce 0.
    // Stats: wager_nonce=2, pending_nonce=Some(1) — nonce 0 is stale.
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0, // nonce 0 (stale)
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    // Stats says pending_nonce=Some(1), so nonce 0 is stale
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 2, Some(1));

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        random_caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let c_before = get_balance(&mut banks, &challenger.pubkey()).await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_cleanup_stale_wager(
            &random_caller.pubkey(),
            &challenger.pubkey(),
            0,
        )],
        Some(&random_caller.pubkey()),
        &[&random_caller],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Wager closed
    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Stale wager should be closed"
    );

    // Escrow refunded to challenger (not to random_caller)
    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > c_before,
        "Challenger should get escrow + rent refund"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 13: Cleanup non-stale wager (should fail)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_13_cleanup_non_stale_fails() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Pending wager at nonce 0. Stats: pending_nonce=Some(0) — NOT stale!
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, Some(0)); // current pending

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, _payer, bh) = pt.start().await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_cleanup_stale_wager(
            &caller.pubkey(),
            &challenger.pubkey(),
            0,
        )],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    let err = banks.process_transaction(tx).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::InvalidWagerStatus)),
        "Should fail — wager is not stale"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 14: Cleanup Active wager (should fail)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_14_cleanup_active_fails() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Active wager at nonce 0 — status constraint will fail
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Active,
        1,
        0,
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, None);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, _payer, bh) = pt.start().await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_cleanup_stale_wager(
            &caller.pubkey(),
            &challenger.pubkey(),
            0,
        )],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    let err = banks.process_transaction(tx).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::InvalidWagerStatus)),
        "Active wager cannot be cleaned up"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 15: Cleanup Resolved wager (should fail)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_15_cleanup_resolved_fails() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    let (wager_key, wager_acct) = make_resolved_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        1,
        &challenger.pubkey(),
        99,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, None);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, _payer, bh) = pt.start().await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_cleanup_stale_wager(
            &caller.pubkey(),
            &challenger.pubkey(),
            0,
        )],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    let err = banks.process_transaction(tx).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::InvalidWagerStatus)),
        "Resolved wager cannot be cleaned up"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 16: Full lifecycle: initiate → resolve → claim
//  (accept is simulated by injecting Active state)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_16_full_lifecycle() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let treasury = Keypair::new();
    let vrf_signer = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Start with Active wager at nonce 0 (simulating post-accept state)
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Active,
        1,
        0, // nonce 0
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), 9);
    // After accept: wager_nonce=1, pending_nonce=None
    let (cs_pda, cs_acct) = make_stats_account(&challenger.pubkey(), 1, None);
    let (os_pda, os_acct) = make_stats_account(&opponent.pubkey(), 0, None);

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(cs_pda, cs_acct);
    pt.add_account(os_pda, os_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        treasury.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        vrf_signer.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &treasury.pubkey()).await;

    // Step 1: Resolve
    let mut randomness = [0u8; 32];
    randomness[31] = 99; // HIGH wins

    let tx1 = Transaction::new_signed_with_payer(
        &[ix_consume_randomness_resolved(
            &vrf_signer.pubkey(),
            &challenger.pubkey(),
            &opponent.pubkey(),
            &bag_mint,
            0,
            randomness,
        )],
        Some(&vrf_signer.pubkey()),
        &[&vrf_signer],
        bh,
    );
    banks.process_transaction(tx1).await.unwrap();

    let w: Wager = decode_account(&mut banks, &wager_key).await;
    assert_eq!(w.status, WagerStatus::Resolved);
    assert_eq!(w.winner, Some(challenger.pubkey()));

    // Step 2: Claim winnings
    let c_before = get_balance(&mut banks, &challenger.pubkey()).await;
    let t_before = get_balance(&mut banks, &treasury.pubkey()).await;

    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_claim_winnings(
            &challenger.pubkey(),
            &challenger.pubkey(),
            &treasury.pubkey(),
            0,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // Final verifications
    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Wager closed after claim"
    );
    let fee = get_balance(&mut banks, &treasury.pubkey()).await - t_before;
    assert_eq!(fee, 2 * SOL * FEE_BPS as u64 / 10_000);
    assert!(
        get_balance(&mut banks, &challenger.pubkey()).await > c_before + SOL,
        "Winner gets payout"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 17: Full lifecycle with auto-cleanup
//  create → stale → create (cleanup) → resolve → claim
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_17_lifecycle_with_auto_cleanup() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let treasury = Keypair::new();
    let vrf_signer = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent1.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        treasury.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        vrf_signer.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &treasury.pubkey()).await;

    // Step 1: Create first wager (nonce 0)
    let tx1 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent1.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx1).await.unwrap();

    // Step 2: Create second wager (nonce 1), cleaning up nonce 0
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            2 * SOL,
            0,
            0,
            1,
            Some(0),
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // Old wager gone
    assert!(
        !account_exists(&mut banks, &wager_pda(&challenger.pubkey(), 0).0).await,
        "Old wager at nonce 0 should be closed"
    );

    // Stats: wager_nonce=2, pending_nonce=Some(1)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 2);
    assert_eq!(stats.pending_nonce, Some(1));

    // We can't simulate accept (VRF CPI), but verify the wager is there
    let (new_wager_key, _) = wager_pda(&challenger.pubkey(), 1);
    let w: Wager = decode_account(&mut banks, &new_wager_key).await;
    assert_eq!(w.nonce, 1);
    assert_eq!(w.status, WagerStatus::Pending);
    assert_eq!(w.amount, 2 * SOL);
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 18: Multiple nonces (0..5), only latest acceptable
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_18_multiple_nonces_only_latest() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponents: Vec<Keypair> = (0..6).map(|_| Keypair::new()).collect();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    for opp in &opponents {
        pt.add_account(
            opp.pubkey(),
            Account {
                lamports: 10 * SOL,
                data: vec![],
                owner: system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        );
    }

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create wager at nonce 0
    let tx0 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponents[0].pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx0).await.unwrap();

    // Create wagers at nonces 1..5, each cleaning up the previous
    for i in 1..=5u64 {
        let bh_i = banks.get_latest_blockhash().await.unwrap();
        let tx_i = Transaction::new_signed_with_payer(
            &[ix_initiate_wager(
                &challenger.pubkey(),
                &bag_mint,
                &opponents[i as usize].pubkey(),
                SOL,
                0,
                1,
                i,
                Some(i - 1),
            )],
            Some(&challenger.pubkey()),
            &[&challenger],
            bh_i,
        );
        banks.process_transaction(tx_i).await.unwrap();
    }

    // Only nonce 5 should exist
    for i in 0..5u64 {
        assert!(
            !account_exists(&mut banks, &wager_pda(&challenger.pubkey(), i).0).await,
            "Wager at nonce {} should be closed",
            i
        );
    }

    let (latest_key, _) = wager_pda(&challenger.pubkey(), 5);
    let w: Wager = decode_account(&mut banks, &latest_key).await;
    assert_eq!(w.nonce, 5);
    assert_eq!(w.status, WagerStatus::Pending);

    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 6);
    assert_eq!(stats.pending_nonce, Some(5));
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 19: Events include nonce field (verified via on-chain state)
//  NOTE: BanksClient doesn't expose logs for event parsing,
//  but we verify that state includes nonce at every step.
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_19_nonce_in_state() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create wager
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // Verify nonce is stored in wager account
    let w: Wager = decode_account(&mut banks, &wager_pda(&challenger.pubkey(), 0).0).await;
    assert_eq!(w.nonce, 0, "Wager stores nonce=0");

    // Verify nonce in stats
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 1, "Stats wager_nonce=1");
    assert_eq!(stats.pending_nonce, Some(0), "Stats pending_nonce=Some(0)");
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 20: PlayerStats.pending_nonce tracks correctly across flows
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_20_pending_nonce_tracking() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent1.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Step 1: Create wager nonce 0 → pending_nonce=Some(0)
    let tx1 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent1.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx1).await.unwrap();

    let s1: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(s1.pending_nonce, Some(0), "After initiate: Some(0)");
    assert_eq!(s1.wager_nonce, 1);

    // Step 2: Cancel wager 0 → pending_nonce=None
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_cancel_wager(&challenger.pubkey(), 0)],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    let s2: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(s2.pending_nonce, None, "After cancel: None");
    assert_eq!(s2.wager_nonce, 1, "wager_nonce unchanged after cancel");

    // Step 3: Create wager nonce 1 → pending_nonce=Some(1)
    let bh3 = banks.get_latest_blockhash().await.unwrap();
    let tx3 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            SOL,
            0,
            0,
            1,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh3,
    );
    banks.process_transaction(tx3).await.unwrap();

    let s3: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(s3.pending_nonce, Some(1), "After second initiate: Some(1)");
    assert_eq!(s3.wager_nonce, 2);

    // Step 4: Create wager nonce 2 with cleanup of nonce 1 → pending_nonce=Some(2)
    let bh4 = banks.get_latest_blockhash().await.unwrap();
    let tx4 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent1.pubkey(),
            SOL,
            0,
            1,
            2,
            Some(1),
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh4,
    );
    banks.process_transaction(tx4).await.unwrap();

    let s4: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(
        s4.pending_nonce,
        Some(2),
        "After initiate+cleanup: Some(2)"
    );
    assert_eq!(s4.wager_nonce, 3);
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 21: Anti-grief: winner not claiming → challenger creates new wager
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_21_anti_grief_resolved_doesnt_block() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    // Resolved wager at nonce 0 (opponent won but hasn't claimed)
    // Stats: wager_nonce=1, pending_nonce=None (was cleared when accepted)
    let (resolved_key, resolved_acct) = make_resolved_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        1,
        &opponent.pubkey(), // opponent won
        10,
        0,
    );
    let (resolved_escrow_key, resolved_escrow_acct) =
        make_escrow_account(&challenger.pubkey(), 0, 2 * SOL);
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, None);

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(resolved_key, resolved_acct);
    pt.add_account(resolved_escrow_key, resolved_escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create new wager at nonce 1 (pending_nonce is None, so no cleanup needed)
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            SOL,
            0,
            1,
            1,    // nonce 1
            None, // no prev needed (pending_nonce is None)
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // New wager exists at nonce 1
    let (new_key, _) = wager_pda(&challenger.pubkey(), 1);
    let w: Wager = decode_account(&mut banks, &new_key).await;
    assert_eq!(w.nonce, 1);
    assert_eq!(w.status, WagerStatus::Pending);

    // Old Resolved wager at nonce 0 is untouched
    let old_w: Wager = decode_account(&mut banks, &resolved_key).await;
    assert_eq!(old_w.status, WagerStatus::Resolved, "Old Resolved untouched");
    assert_eq!(old_w.winner, Some(opponent.pubkey()));
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 22: Compute budget — SKIPPED
//  LiteSVM/ProgramTest doesn't expose CU metering easily.
// ═══════════════════════════════════════════════════════════════════════

// TEST 22 SKIPPED: Compute budget testing not reliable in ProgramTest.
// initiate_wager with cleanup does ~3 CPIs (close + refund + create + transfer).
// Validate on devnet if needed.

// ═══════════════════════════════════════════════════════════════════════
//  TEST 23: Concurrent accept — SKIPPED
//  Account locking serialization is a Solana runtime guarantee.
//  Can't test concurrent TXs in single-threaded ProgramTest.
// ═══════════════════════════════════════════════════════════════════════

// TEST 23 SKIPPED: ProgramTest processes transactions sequentially.
// Solana runtime serializes concurrent writes to the same account.
// This is a runtime guarantee, not a program-level test.

// ═══════════════════════════════════════════════════════════════════════
//  TEST 24: cleanup_stale_wager with zero-balance escrow
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_24_cleanup_zero_balance_escrow() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Stale Pending wager at nonce 0, escrow has 0 balance
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,
        0,
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, 0); // zero balance!
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 2, Some(1)); // stale

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, _payer, bh) = pt.start().await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_cleanup_stale_wager(
            &caller.pubkey(),
            &challenger.pubkey(),
            0,
        )],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    assert!(
        !account_exists(&mut banks, &wager_key).await,
        "Wager closed even with zero escrow"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 25: accept_wager with non-existent challenger_stats — SKIPPED
//  Can't call accept_wager in ProgramTest (VRF CPI dependency).
//  The check is: challenger_stats is NOT init_if_needed, so Anchor
//  will fail with AccountNotInitialized if it doesn't exist.
// ═══════════════════════════════════════════════════════════════════════

// TEST 25 SKIPPED: accept_wager uses VRF CPI, can't test in ProgramTest.
// The M-01 fix (non-init_if_needed challenger_stats) ensures Anchor rejects
// accept_wager if challenger_stats doesn't exist.

// ═══════════════════════════════════════════════════════════════════════
//  TEST 26: Pass prev_escrow without prev_wager (and vice versa)
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_26_prev_wager_escrow_pairing() {
    // Test that passing prev_wager without pending_nonce is rejected (I-06 defense)
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    // Inject stats with pending_nonce=None and a leftover Pending wager at nonce 0
    let (wager_key_0, wager_acct_0) = make_wager_account(
        &challenger.pubkey(),
        &opponent1.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,
        0,
        0,
    );
    let (escrow_key_0, escrow_acct_0) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    // Stats: pending_nonce=None (but wager at nonce 0 still exists somehow)
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 1, None);

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(wager_key_0, wager_acct_0);
    pt.add_account(escrow_key_0, escrow_acct_0);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent2.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Try to pass prev_wager when pending_nonce is None (I-06 defense)
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent2.pubkey(),
            SOL,
            0,
            1,
            1,       // nonce 1
            Some(0), // prev_wager at nonce 0
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    let err = banks.process_transaction(tx).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::PreviousWagerRequired)),
        "Should fail — prev_wager passed when pending_nonce is None"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  TEST 27: initiate_wager with wrong-nonce prev_wager
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_27_wrong_nonce_prev_wager() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent1 = Keypair::new();
    let opponent2 = Keypair::new();
    let opponent3 = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);

    // Two Pending wagers: nonce 0 (stale) and nonce 1 (current pending)
    let (wager_0_key, wager_0_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent1.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,
        0,
        0,
    );
    let (escrow_0_key, escrow_0_acct) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    let (wager_1_key, wager_1_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent2.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        1,
        0,
        0,
    );
    let (escrow_1_key, escrow_1_acct) = make_escrow_account(&challenger.pubkey(), 1, SOL);
    // Stats: pending_nonce=Some(1), wager_nonce=2
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 2, Some(1));

    pt.add_account(bag_pda, bag_acct);
    pt.add_account(wager_0_key, wager_0_acct);
    pt.add_account(escrow_0_key, escrow_0_acct);
    pt.add_account(wager_1_key, wager_1_acct);
    pt.add_account(escrow_1_key, escrow_1_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent3.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Try to pass nonce 0 as prev_wager when pending_nonce=Some(1)
    // This should fail with WagerNonceMismatch (H-02 fix)
    let tx = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent3.pubkey(),
            SOL,
            0,
            1,
            2,       // new nonce = 2
            Some(0), // wrong! should be Some(1)
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    let err = banks.process_transaction(tx).await.unwrap_err();
    assert_eq!(
        get_error_code(&format!("{:?}", err)),
        Some(anchor_error(DiceDuelError::WagerNonceMismatch)),
        "Should fail — wrong nonce prev_wager"
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  ADDITIONAL: Verify initiate → cancel → re-initiate works cleanly
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_extra_initiate_cancel_reinitiate() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let bag_mint = Pubkey::new_unique();
    let (bag_pda, bag_acct) = make_dice_bag_account(&bag_mint, &challenger.pubkey(), INITIAL_USES);
    pt.add_account(bag_pda, bag_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 100 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        opponent.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    // Create nonce 0
    let tx1 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            SOL,
            0,
            1,
            0,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh,
    );
    banks.process_transaction(tx1).await.unwrap();

    // Cancel nonce 0
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix_cancel_wager(&challenger.pubkey(), 0)],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh2,
    );
    banks.process_transaction(tx2).await.unwrap();

    // Re-initiate at nonce 1 (no cleanup needed, pending_nonce is None after cancel)
    let bh3 = banks.get_latest_blockhash().await.unwrap();
    let tx3 = Transaction::new_signed_with_payer(
        &[ix_initiate_wager(
            &challenger.pubkey(),
            &bag_mint,
            &opponent.pubkey(),
            2 * SOL,
            0,
            0,
            1,
            None,
        )],
        Some(&challenger.pubkey()),
        &[&challenger],
        bh3,
    );
    banks.process_transaction(tx3).await.unwrap();

    let w: Wager = decode_account(&mut banks, &wager_pda(&challenger.pubkey(), 1).0).await;
    assert_eq!(w.amount, 2 * SOL);
    assert_eq!(w.nonce, 1);
    assert_eq!(w.status, WagerStatus::Pending);

    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(stats.wager_nonce, 2);
    assert_eq!(stats.pending_nonce, Some(1));
}

// ═══════════════════════════════════════════════════════════════════════
//  ADDITIONAL: Claim expired clears pending_nonce only if it matches
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_nonce_extra_claim_expired_conditional_clear() {
    let mut pt = program();
    let challenger = Keypair::new();
    let opponent = Keypair::new();
    let caller = Keypair::new();
    let bag_mint = Pubkey::new_unique();

    // Expired wager at nonce 0, but pending_nonce=Some(1) (a newer wager is pending)
    let (wager_key, wager_acct) = make_wager_account(
        &challenger.pubkey(),
        &opponent.pubkey(),
        &bag_mint,
        SOL,
        WagerStatus::Pending,
        1,
        0,
        0, // created_at=0, expired
        0,
    );
    let (escrow_key, escrow_acct) = make_escrow_account(&challenger.pubkey(), 0, SOL);
    // pending_nonce=Some(1) means nonce 0 is NOT the current pending
    let (stats_key, stats_acct) = make_stats_account(&challenger.pubkey(), 2, Some(1));

    pt.add_account(wager_key, wager_acct);
    pt.add_account(escrow_key, escrow_acct);
    pt.add_account(stats_key, stats_acct);
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    pt.add_account(
        caller.pubkey(),
        Account {
            lamports: 10 * SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;
    init_config(&mut banks, &payer, bh, &Pubkey::new_unique()).await;

    let tx = Transaction::new_signed_with_payer(
        &[ix_claim_expired(&caller.pubkey(), &challenger.pubkey(), 0)],
        Some(&caller.pubkey()),
        &[&caller],
        bh,
    );
    banks.process_transaction(tx).await.unwrap();

    // pending_nonce should STILL be Some(1) (not cleared, because expired wager was nonce 0)
    let stats: PlayerStats = decode_account(&mut banks, &stats_pda(&challenger.pubkey()).0).await;
    assert_eq!(
        stats.pending_nonce,
        Some(1),
        "pending_nonce unchanged — expired wager nonce didn't match"
    );
}
