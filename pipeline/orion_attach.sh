#!/usr/bin/env bash
# Attach the ORION Gallatin SQL Server DB in Docker (if not already) and bcp-export the tables the
# pipeline needs into data/derived/*.csv (pipe-delimited, no header).
#
# Credentials: SA password for a container bound to localhost only, taken from
# $MSSQL_SA_PASSWORD (never committed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PW="${MSSQL_SA_PASSWORD:?set MSSQL_SA_PASSWORD (local SA password; for an existing container, the one it was created with)}"
PORT="${ORION_PORT:-14333}"
DERIVED="$ROOT/data/derived"; mkdir -p "$DERIVED"

# Reuse a running container named orion-test or orion; else create "orion".
C=""
for name in orion-test orion; do
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then C=$name; break; fi
done
if [ -z "$C" ]; then
  C=orion
  MSSQL_DIR="$ROOT/data/raw/orion/mssql"; mkdir -p "$MSSQL_DIR"
  if [ ! -f "$MSSQL_DIR/Gallatin.mdf" ]; then
    unzip -o "$ROOT/data/raw/orion/COUNTY6_Gallatin_ORION_2026-11-06.zip" -d "$ROOT/data/raw/orion/"
    cp "$ROOT/data/raw/orion/Output.mdf" "$MSSQL_DIR/Gallatin.mdf"; chmod 666 "$MSSQL_DIR/Gallatin.mdf"
  fi
  docker rm -f orion >/dev/null 2>&1 || true
  docker run -d --name orion --platform linux/amd64 -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$PW" -e MSSQL_PID=Express \
    -v "$MSSQL_DIR:/data" -p "127.0.0.1:$PORT:1433" mcr.microsoft.com/mssql/server:2022-latest
  for i in $(seq 1 60); do
    docker exec orion /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$PW" -Q "SELECT 1" >/dev/null 2>&1 && break; sleep 3
  done
  docker exec orion /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$PW" \
    -Q "IF DB_ID('Gallatin') IS NULL CREATE DATABASE Gallatin ON (FILENAME='/data/Gallatin.mdf') FOR ATTACH_REBUILD_LOG;"
fi
echo "using container $C"

export_q() { # name query
  docker exec "$C" /opt/mssql-tools18/bin/bcp "$2" queryout "/tmp/$1.csv" -c -t "|" -u -S tcp:127.0.0.1,1433 -U sa -P "$PW" | tail -2
  docker cp "$C:/tmp/$1.csv" "$DERIVED/$1.csv"
}
Y="TaxYear IN (2025,2026)"
export_q property "SELECT PropertyID, TaxYear, GeoCode, AssessmentCode, LevyDistrict, PropType, PropCategory, PropSubCategory, LivUnits, Dwel_Val, Com_Val, TotImpt_Val, TotMarket_Val, Addr_Number, Addr_Street, Addr_City, Addr_UnitNumber FROM Gallatin.dbo.Property WHERE $Y"
export_q assessment "SELECT AssessmentID, PropertyID, TaxYear, ClassCode, LandValue, BuildingValue, TotalValue, ExemptValue, TaxableMktValue, TaxablePct, TaxableValue, TIFIncVal, TotalMills, TaxAmount FROM Gallatin.dbo.Assessment WHERE $Y"
export_q condomaster "SELECT PropertyID, TaxYear, CondoMasterId FROM Gallatin.dbo.CondoMaster WHERE $Y"
export_q res "SELECT ResID, PropertyID, TaxYear, YearBuilt, StoryHeight, SFLA, Bedrooms, RCNLD FROM Gallatin.dbo.Res WHERE $Y"
export_q com "SELECT ComID, PropertyID, TaxYear, BuildingNumber, REPLACE(StructureType_Desc,'|','/'), YearBuilt, RCNLD FROM Gallatin.dbo.Com WHERE $Y"
export_q classcodes "SELECT Code, REPLACE(Description,'|','/') FROM Gallatin.dbo.ClassCodes"
wc -l "$DERIVED"/{property,assessment,condomaster,res,com,classcodes}.csv
