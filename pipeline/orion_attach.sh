#!/usr/bin/env bash
# Attach a county's ORION SQL Server DB in Docker (if not already attached) and bcp-export the tables the
# pipeline needs into data/derived/<county>/*.csv (pipe-delimited, no header).
#
#   MSSQL_SA_PASSWORD=... ./orion_attach.sh gallatin|yellowstone
#
# Credentials: SA password for a container bound to localhost only, taken from $MSSQL_SA_PASSWORD
# (never committed). Reuses a running container named orion-test or orion, else creates "orion".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COUNTY="${1:-gallatin}"
case "$COUNTY" in
  gallatin)    DB=Gallatin;    ZIP=COUNTY6_Gallatin_ORION_2026-11-06.zip ;;
  yellowstone) DB=Yellowstone; ZIP=COUNTY3.ZIP ;;
  *) echo "unknown county $COUNTY"; exit 1 ;;
esac
PW="${MSSQL_SA_PASSWORD:?set MSSQL_SA_PASSWORD (local SA password; for an existing container, the one it was created with)}"
PORT="${ORION_PORT:-14333}"
RAW="$ROOT/data/raw/$COUNTY/orion"
DERIVED="$ROOT/data/derived/$COUNTY"; mkdir -p "$DERIVED"
SQL() { docker exec "$C" /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$PW" -h -1 -W -Q "SET NOCOUNT ON; $1"; }

C=""
for name in orion-test orion; do
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then C=$name; break; fi
done
if [ -z "$C" ]; then
  C=orion
  docker rm -f orion >/dev/null 2>&1 || true
  docker run -d --name orion --platform linux/amd64 -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$PW" -e MSSQL_PID=Express \
    -p "127.0.0.1:$PORT:1433" mcr.microsoft.com/mssql/server:2022-latest
fi
for i in $(seq 1 60); do SQL "SELECT 1" >/dev/null 2>&1 && break; sleep 3; done
echo "using container $C"

if [ "$(SQL "SELECT COUNT(*) FROM sys.databases WHERE name='$DB'" | tr -d '[:space:]')" != "1" ]; then
  if [ ! -f "$RAW/Output.mdf" ]; then unzip -o "$RAW/$ZIP" -d "$RAW/"; fi
  MDF=$(ls "$RAW"/*.mdf | head -1)
  docker exec -u 0 "$C" mkdir -p /var/opt/mssql/attach
  docker cp "$MDF" "$C:/var/opt/mssql/attach/$DB.mdf"
  docker exec -u 0 "$C" chown -R mssql /var/opt/mssql/attach || docker exec -u 0 "$C" chmod -R 777 /var/opt/mssql/attach
  SQL "CREATE DATABASE [$DB] ON (FILENAME='/var/opt/mssql/attach/$DB.mdf') FOR ATTACH_REBUILD_LOG;"
fi

export_q() { # name query
  docker exec "$C" /opt/mssql-tools18/bin/bcp "$2" queryout "/tmp/$1.csv" -c -t "|" -u -S tcp:127.0.0.1,1433 -U sa -P "$PW" | tail -1
  docker cp "$C:/tmp/$1.csv" "$DERIVED/$1.csv"
}
Y="TaxYear IN (2025,2026)"
export_q property "SELECT PropertyID, TaxYear, GeoCode, AssessmentCode, LevyDistrict, PropType, PropCategory, PropSubCategory, LivUnits, Dwel_Val, Com_Val, TotImpt_Val, TotMarket_Val, Addr_Number, Addr_Street, Addr_City, Addr_UnitNumber FROM $DB.dbo.Property WHERE $Y"
export_q assessment "SELECT AssessmentID, PropertyID, TaxYear, ClassCode, LandValue, BuildingValue, TotalValue, ExemptValue, TaxableMktValue, TaxablePct, TaxableValue, TIFIncVal, TotalMills, TaxAmount FROM $DB.dbo.Assessment WHERE $Y"
export_q condomaster "SELECT PropertyID, TaxYear, CondoMasterId FROM $DB.dbo.CondoMaster WHERE $Y"
export_q res "SELECT ResID, PropertyID, TaxYear, YearBuilt, StoryHeight, SFLA, Bedrooms, RCNLD FROM $DB.dbo.Res WHERE $Y"
export_q com "SELECT ComID, PropertyID, TaxYear, BuildingNumber, REPLACE(StructureType_Desc,'|','/'), YearBuilt, RCNLD FROM $DB.dbo.Com WHERE $Y"
export_q classcodes "SELECT Code, REPLACE(Description,'|','/') FROM $DB.dbo.ClassCodes"
wc -l "$DERIVED"/{property,assessment,condomaster,res,com,classcodes}.csv
