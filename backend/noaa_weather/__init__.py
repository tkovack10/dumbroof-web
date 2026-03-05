"""
NOAA Weather Intelligence Module
Automated storm data retrieval from NOAA SWDI + SPC with damage threshold auto-calculation.
"""

__version__ = "1.0.0"

from noaa_weather.api import NOAAClient, NOAAStormEvent, NOAAStormData
from noaa_weather.geocode import geocode_address
from noaa_weather.thresholds import DAMAGE_THRESHOLDS, get_threshold
from noaa_weather.analyzer import ThresholdAnalyzer
