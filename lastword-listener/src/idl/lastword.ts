/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lastword.json`.
 */
export type Lastword = {
  "address": "D4Frg928RDwrsxYHZnjcwHhMVz8VaKy2zo4raMc1cLL6",
  "metadata": {
    "name": "lastword",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancel",
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "walletSwitchCount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  119,
                  111,
                  114,
                  100,
                  95,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "switchAccount",
            "walletSwitchCount"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "cancelSpl",
      "discriminator": [
        147,
        74,
        147,
        41,
        28,
        118,
        70,
        94
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "walletSwitchCount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  119,
                  111,
                  114,
                  100,
                  95,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "docs": [
            "Escrow ATA owned by the switch PDA"
          ],
          "writable": true
        },
        {
          "name": "ownerTokenAccount",
          "docs": [
            "Owner's ATA to receive tokens back"
          ],
          "writable": true
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "switchAccount",
            "walletSwitchCount"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "checkin",
      "discriminator": [
        223,
        175,
        165,
        27,
        123,
        7,
        54,
        252
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "switchAccount"
          ]
        },
        {
          "name": "ixSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "createSwitch",
      "discriminator": [
        120,
        11,
        193,
        114,
        80,
        234,
        99,
        128
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "walletSwitchCount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  119,
                  111,
                  114,
                  100,
                  95,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "switchId",
          "type": "u8"
        },
        {
          "name": "switchType",
          "type": {
            "defined": {
              "name": "switchType"
            }
          }
        },
        {
          "name": "beneficiaryType",
          "type": {
            "defined": {
              "name": "beneficiaryType"
            }
          }
        },
        {
          "name": "beneficiary",
          "type": "pubkey"
        },
        {
          "name": "intervalDays",
          "type": "u64"
        },
        {
          "name": "payloadHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "arweaveTxId",
          "type": {
            "array": [
              "u8",
              43
            ]
          }
        },
        {
          "name": "escrowedAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "trigger",
      "discriminator": [
        215,
        172,
        161,
        36,
        115,
        157,
        116,
        147
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "beneficiary",
          "writable": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "triggerSpl",
      "discriminator": [
        234,
        75,
        197,
        62,
        220,
        66,
        233,
        224
      ],
      "accounts": [
        {
          "name": "switchAccount",
          "writable": true
        },
        {
          "name": "escrowTokenAccount",
          "docs": [
            "Escrow ATA owned by the switch PDA"
          ],
          "writable": true
        },
        {
          "name": "beneficiaryTokenAccount",
          "docs": [
            "Beneficiary's ATA — must match switch_account.beneficiary"
          ],
          "writable": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "switchAccount",
      "discriminator": [
        142,
        228,
        4,
        199,
        149,
        78,
        209,
        113
      ]
    },
    {
      "name": "walletSwitchCount",
      "discriminator": [
        203,
        92,
        253,
        30,
        53,
        19,
        110,
        150
      ]
    }
  ],
  "events": [
    {
      "name": "checkinCompleted",
      "discriminator": [
        35,
        228,
        166,
        241,
        165,
        72,
        46,
        141
      ]
    },
    {
      "name": "instructionTriggered",
      "discriminator": [
        172,
        128,
        6,
        181,
        194,
        94,
        226,
        143
      ]
    },
    {
      "name": "messageTriggered",
      "discriminator": [
        53,
        57,
        27,
        6,
        104,
        204,
        213,
        51
      ]
    },
    {
      "name": "switchCancelled",
      "discriminator": [
        46,
        196,
        183,
        131,
        1,
        130,
        141,
        151
      ]
    },
    {
      "name": "switchCreated",
      "discriminator": [
        55,
        40,
        99,
        122,
        102,
        61,
        8,
        156
      ]
    },
    {
      "name": "switchTriggered",
      "discriminator": [
        108,
        114,
        165,
        112,
        188,
        173,
        179,
        11
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidSwitchId",
      "msg": "Switch ID must be between 0 and 4"
    },
    {
      "code": 6001,
      "name": "invalidInterval",
      "msg": "Interval must be between 3 and 365 days"
    },
    {
      "code": 6002,
      "name": "switchNotActive",
      "msg": "Switch is not in Active status"
    },
    {
      "code": 6003,
      "name": "deadlinePassed",
      "msg": "Deadline has already passed — switch should be triggered"
    },
    {
      "code": 6004,
      "name": "deadlineNotReached",
      "msg": "Deadline has not been reached yet"
    },
    {
      "code": 6005,
      "name": "invalidSignature",
      "msg": "Invalid ed25519 signature over challenge nonce"
    },
    {
      "code": 6006,
      "name": "cancelCooldownActive",
      "msg": "Cannot cancel within 48 hours of creation"
    },
    {
      "code": 6007,
      "name": "switchLimitReached",
      "msg": "Wallet has reached the maximum of 5 active switches"
    },
    {
      "code": 6008,
      "name": "useTriggerSpl",
      "msg": "SPL asset switch — use trigger_spl instruction"
    },
    {
      "code": 6009,
      "name": "useCancelSpl",
      "msg": "SPL asset switch — use cancel_spl instruction"
    },
    {
      "code": 6010,
      "name": "wrongSwitchType",
      "msg": "Wrong switch type for this instruction"
    },
    {
      "code": 6011,
      "name": "notSplSwitch",
      "msg": "This switch does not have an SPL mint"
    },
    {
      "code": 6012,
      "name": "wrongBeneficiary",
      "msg": "Beneficiary account does not match switch record"
    },
    {
      "code": 6013,
      "name": "wrongTokenAccount",
      "msg": "Token account does not match expected mint or owner"
    }
  ],
  "types": [
    {
      "name": "beneficiaryType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "wallet"
          },
          {
            "name": "squads"
          },
          {
            "name": "arweave"
          }
        ]
      }
    },
    {
      "name": "checkinCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "newDeadlineSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "instructionTriggered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "messageTriggered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "arweaveTxId",
            "type": {
              "array": [
                "u8",
                43
              ]
            }
          },
          {
            "name": "payloadHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "switchAccount",
      "docs": [
        "One switch per PDA. Seed: [\"lastword\", owner, switch_id]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "switchType",
            "type": {
              "defined": {
                "name": "switchType"
              }
            }
          },
          {
            "name": "beneficiaryType",
            "type": {
              "defined": {
                "name": "beneficiaryType"
              }
            }
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "checkinIntervalSlots",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "lastCheckinSlot",
            "type": "u64"
          },
          {
            "name": "checkinWindowOpen",
            "type": "u64"
          },
          {
            "name": "challengeNonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "switchStatus"
              }
            }
          },
          {
            "name": "payloadHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "arweaveTxId",
            "type": {
              "array": [
                "u8",
                43
              ]
            }
          },
          {
            "name": "escrowedMint",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "escrowedAmount",
            "type": "u64"
          },
          {
            "name": "protocolFeePaid",
            "type": "u64"
          },
          {
            "name": "createdAtSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "switchCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "switchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "switchType",
            "type": {
              "defined": {
                "name": "switchType"
              }
            }
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "switchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "triggered"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "switchTriggered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "switchId",
            "type": "u8"
          },
          {
            "name": "triggeredBy",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "switchType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "message"
          },
          {
            "name": "asset"
          },
          {
            "name": "instruction"
          }
        ]
      }
    },
    {
      "name": "walletSwitchCount",
      "docs": [
        "Tracks how many active switches a wallet currently has.",
        "PDA seed: [\"lastword_count\", owner]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
